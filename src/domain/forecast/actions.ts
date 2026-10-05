/**
 * M5:打ち手の試算。「外食をあと1回減らす」のようなカテゴリ単位の打ち手を、
 * 元の予測と同じ乱数(共通乱数法)でシミュレーションし直し、予算内に収まる
 * 確率・着地額がどう変わるかを出す。
 *
 * 共通乱数法の実装:カテゴリごとに独立した乱数列(seedにカテゴリIDを混ぜる)
 * を持たせる。ベースラインと打ち手の試行は、対象カテゴリ以外は完全に同じ
 * 乱数列から引くため、差は打ち手の効果だけになる(揺れが打ち消し合う)。
 * 対象カテゴリ自身は、回数が変われば消費する乱数の個数も変わるため厳密には
 * 乱数列がずれるが、他のカテゴリ・特別費への影響は無い(独立したストリーム
 * のため)。M3の simulateForecast() が使う単一の共有ストリームとは別の、
 * この試算専用の軽量なシミュレーションを使う(ベイズモデルのみ対応。
 * ブートストラップ方式での打ち手試算はスコープ外、docs/decisions.md 参照)。
 */

import { weekdayOf, type DateOnly } from '@/lib/date';
import { eachDay } from '@/domain/period';
import { isHoliday } from './holidays';
import { isPaydayWindow } from './model';
import {
  createRng,
  pickOne,
  sampleGamma,
  sampleLognormal,
  samplePoisson,
  sampleStandardNormal,
} from './rng';
import type { CategoryModelParams, FittedModel, ForecastDriver } from './types';

export type ActionKind = 'reduce_count' | 'every_other_day';

export type ActionCandidate = {
  categoryId: string;
  categoryName: string;
  kind: ActionKind;
  description: string;
  /** そのカテゴリの回数の率(λ×曜日等係数の合計)に掛ける倍率。 */
  rateMultiplier: number;
};

export type ActionResult = {
  action: ActionCandidate;
  baselineProbWithinBudget: number | null;
  newProbWithinBudget: number | null;
  probDelta: number | null;
  baselineP50: number;
  newP50: number;
  /** 着地額の変化(負なら改善=減る)。 */
  totalDelta: number;
};

export type ActionSimulationInput = {
  periodId: string;
  today: DateOnly;
  periodTo: DateOnly;
  fitted: FittedModel;
  committedYen: number;
  actualYen: number;
  specialHistoricalAmounts: readonly number[];
  specialOccurrencesPerDay: number;
  remainingDays: number;
  budgetYen: number | null;
  payday: number | null;
  dataVersion: string;
  trials?: number;
};

const DEFAULT_ACTION_TRIALS = 2000;
/** 「あと1回減らす」の1回を、残り期間の期待回数から差し引くための下限。 */
const MIN_EXPECTED_COUNT_FOR_REDUCE = 0.2;

/** drivers(超過リスクの主な原因、上位カテゴリ)から打ち手の候補を作る(M5)。 */
export function buildActionCandidates(
  drivers: readonly ForecastDriver[],
  categories: readonly CategoryModelParams[],
  maxCategories = 3,
): ActionCandidate[] {
  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const targets = drivers.slice(0, maxCategories);
  const candidates: ActionCandidate[] = [];
  for (const driver of targets) {
    const cat = byId.get(driver.categoryId);
    if (cat === undefined) continue;
    candidates.push({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      kind: 'reduce_count',
      description: `${cat.categoryName}をあと1回減らす`,
      rateMultiplier: -1, // simulateAction 側で「1回ぶん減らす」専用の扱いをする目印
    });
    candidates.push({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      kind: 'every_other_day',
      description: `${cat.categoryName}を1日おきにする`,
      rateMultiplier: 0.5,
    });
  }
  return candidates;
}

function totalFactorFor(
  cat: CategoryModelParams,
  futureDates: readonly DateOnly[],
  payday: number | null,
): number {
  let sum = 0;
  for (const date of futureDates) {
    const wd = weekdayOf(date);
    let factor = cat.weekdayFactor[wd] ?? 1;
    if (payday !== null && isPaydayWindow(date, payday)) factor *= cat.paydayFactor;
    if (isHoliday(date)) factor *= cat.holidayFactor;
    sum += Math.max(0, factor);
  }
  return sum;
}

/**
 * 1カテゴリぶんの、残り期間の変動費を試行回ぶん計算する。rateMultiplier=-1 は
 * 「あと1回減らす」(期待回数から1を引く、下限あり)、それ以外は率への倍率。
 */
function simulateCategoryTrials(
  seed: string,
  cat: CategoryModelParams,
  totalFactor: number,
  trials: number,
  rateMultiplier: number | null,
): Float64Array {
  const rng = createRng(seed);
  const out = new Float64Array(trials);
  for (let t = 0; t < trials; t += 1) {
    const lambda = sampleGamma(rng, cat.countPosterior.alpha, 1 / cat.countPosterior.beta);
    const muTrial =
      cat.amountPosterior.mu +
      Math.sqrt(cat.amountPosterior.sigmaSq / Math.max(cat.amountPosterior.kappa, 0.01)) *
        sampleStandardNormal(rng);
    const sigma = Math.sqrt(cat.amountPosterior.sigmaSq);

    let expectedCount = lambda * totalFactor;
    if (rateMultiplier === -1) {
      expectedCount = Math.max(MIN_EXPECTED_COUNT_FOR_REDUCE, expectedCount - 1);
    } else if (rateMultiplier !== null) {
      expectedCount *= rateMultiplier;
    }

    const count = samplePoisson(rng, expectedCount);
    let total = 0;
    for (let i = 0; i < count; i += 1) total += sampleLognormal(rng, muTrial, sigma);
    out[t] = total;
  }
  return out;
}

function simulateSpecialTrials(
  seed: string,
  historicalAmounts: readonly number[],
  occurrencesPerDay: number,
  remainingDays: number,
  trials: number,
): Float64Array {
  const rng = createRng(seed);
  const out = new Float64Array(trials);
  for (let t = 0; t < trials; t += 1) {
    const count = samplePoisson(rng, occurrencesPerDay * remainingDays);
    let total = 0;
    for (let i = 0; i < count && historicalAmounts.length > 0; i += 1)
      total += pickOne(rng, historicalAmounts);
    out[t] = total;
  }
  return out;
}

function quantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

/**
 * ベースラインと打ち手候補それぞれについて、予算内に収まる確率・着地額の
 * 変化を試算する(M5)。カテゴリごとに独立した乱数列(共通乱数法)を使うため、
 * 対象カテゴリ以外の揺れはベースラインと完全に打ち消し合う。
 */
export function simulateActions(
  input: ActionSimulationInput,
  candidates: readonly ActionCandidate[],
): ActionResult[] {
  const trials = input.trials ?? DEFAULT_ACTION_TRIALS;
  const futureDates = eachDay(input.today, input.periodTo).filter((d) => d > input.today);
  const periodId = input.periodId;
  const baseSeed = `${periodId}:${input.dataVersion}:actions`;

  const categoryTrialsByIdBaseline = new Map<string, Float64Array>();
  const totalFactorById = new Map<string, number>();
  for (const cat of input.fitted.categories) {
    const totalFactor = totalFactorFor(cat, futureDates, input.payday);
    totalFactorById.set(cat.categoryId, totalFactor);
    categoryTrialsByIdBaseline.set(
      cat.categoryId,
      simulateCategoryTrials(`${baseSeed}:cat:${cat.categoryId}`, cat, totalFactor, trials, null),
    );
  }
  const specialTrials = simulateSpecialTrials(
    `${baseSeed}:special`,
    input.specialHistoricalAmounts,
    input.specialOccurrencesPerDay,
    input.remainingDays,
    trials,
  );

  const sumAcross = (perCategory: ReadonlyMap<string, Float64Array>): Float64Array => {
    const total = new Float64Array(trials);
    for (let t = 0; t < trials; t += 1) {
      let sum = input.actualYen + input.committedYen + specialTrials[t]!;
      for (const arr of perCategory.values()) sum += arr[t]!;
      total[t] = sum;
    }
    return total;
  };

  const baselineTotal = sumAcross(categoryTrialsByIdBaseline);
  const baselineSorted = Array.from(baselineTotal).sort((a, b) => a - b);
  const baselineP50 = quantile(baselineSorted, 0.5);
  const baselineProbWithinBudget =
    input.budgetYen !== null
      ? baselineTotal.reduce((n, v) => n + (v <= input.budgetYen! ? 1 : 0), 0) / trials
      : null;

  const results: ActionResult[] = [];
  for (const action of candidates) {
    const cat = input.fitted.categories.find((c) => c.categoryId === action.categoryId);
    const totalFactor = totalFactorById.get(action.categoryId);
    if (cat === undefined || totalFactor === undefined) continue;

    const modifiedCategoryTrials = simulateCategoryTrials(
      `${baseSeed}:cat:${action.categoryId}`,
      cat,
      totalFactor,
      trials,
      action.rateMultiplier,
    );
    const perCategory = new Map(categoryTrialsByIdBaseline);
    perCategory.set(action.categoryId, modifiedCategoryTrials);
    const newTotal = sumAcross(perCategory);
    const newSorted = Array.from(newTotal).sort((a, b) => a - b);
    const newP50 = quantile(newSorted, 0.5);
    const newProbWithinBudget =
      input.budgetYen !== null
        ? newTotal.reduce((n, v) => n + (v <= input.budgetYen! ? 1 : 0), 0) / trials
        : null;

    results.push({
      action,
      baselineProbWithinBudget,
      newProbWithinBudget,
      probDelta:
        baselineProbWithinBudget !== null && newProbWithinBudget !== null
          ? newProbWithinBudget - baselineProbWithinBudget
          : null,
      baselineP50,
      newP50,
      totalDelta: newP50 - baselineP50,
    });
  }

  return results;
}

/** 効果(確率の改善、無ければ着地額の減り)が大きい順に並べ、最大2件を返す(M5)。 */
export function topActions(results: readonly ActionResult[], max = 2): ActionResult[] {
  return [...results]
    .sort((a, b) => {
      if (a.probDelta !== null && b.probDelta !== null) return b.probDelta - a.probDelta;
      return a.totalDelta - b.totalDelta;
    })
    .slice(0, max);
}
