/**
 * M5:打ち手の試算。「外食を週1回へらす」のようなカテゴリ単位の打ち手を、
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
import { isFixedHoliday } from './holidays';
import { isPaydayWindow } from './model';
import {
  createRng,
  pickOne,
  sampleGamma,
  sampleLognormal,
  samplePoisson,
  sampleStandardNormal,
} from './rng';
import type { CategoryModelParams, CategoryPeriodBase, FittedModel, ForecastDriver } from './types';

/**
 * 打ち手の効き方。
 *   reduce_count:残り期間の期待回数から count 回を引く(下限あり)
 *   scale_rate  :残り期間の回数の率に factor を掛ける
 */
export type ActionEffect =
  { type: 'reduce_count'; count: number } | { type: 'scale_rate'; factor: number };

export type ActionCandidate = {
  categoryId: string;
  categoryName: string;
  /** 画面のチップ・選択肢に出す短い名前(例:「週1回へらす」)。 */
  label: string;
  /** 文として出す名前(例:「外食を週1回へらす」)。 */
  description: string;
  effect: ActionEffect;
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
  /** 対象カテゴリの着地額(中央・10回中8回の幅)。 */
  category: {
    landing: { p10: number; p50: number; p90: number };
    targetYen: number | null;
    probOverTarget: number | null;
  };
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
  categoryBases?: readonly CategoryPeriodBase[];
  categoryTargets?: ReadonlyMap<string, number>;
};

const DEFAULT_ACTION_TRIALS = 2000;
/** 回数を減らしても、期待回数はこれより下げない(0回の約束は現実的でないため)。 */
const MIN_EXPECTED_COUNT = 0.2;

/** 「いつも通り」(何も変えない)。比較の基準として選択肢に並べる。 */
export function keepAsIs(categoryId: string, categoryName: string): ActionCandidate {
  return {
    categoryId,
    categoryName,
    label: 'いつも通り',
    description: `${categoryName}はいつも通り`,
    effect: { type: 'scale_rate', factor: 1 },
  };
}

/** 1カテゴリの打ち手の選択肢(週1回へらす・週2回へらす)。 */
export function weeklyReductionCandidates(
  categoryId: string,
  categoryName: string,
  remainingDays: number,
): ActionCandidate[] {
  const weeks = Math.max(0, remainingDays) / 7;
  return [1, 2].map((perWeek) => ({
    categoryId,
    categoryName,
    label: `週${perWeek}回へらす`,
    description: `${categoryName}を週${perWeek}回へらす`,
    effect: { type: 'reduce_count', count: perWeek * weeks },
  }));
}

/**
 * drivers(超過リスクの上位カテゴリ)から打ち手の候補を作る(M5)。
 * 各カテゴリに「あと1回へらす」「週1回へらす」「1日おきにする」を用意する。
 */
export function buildActionCandidates(
  drivers: readonly ForecastDriver[],
  categories: readonly CategoryModelParams[],
  remainingDays: number,
  maxCategories = 3,
): ActionCandidate[] {
  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const candidates: ActionCandidate[] = [];
  for (const driver of drivers.slice(0, maxCategories)) {
    const cat = byId.get(driver.categoryId);
    if (cat === undefined) continue;
    const name = cat.categoryName;
    candidates.push({
      categoryId: cat.categoryId,
      categoryName: name,
      label: 'あと1回へらす',
      description: `${name}をあと1回へらす`,
      effect: { type: 'reduce_count', count: 1 },
    });
    if (remainingDays >= 7) {
      candidates.push(weeklyReductionCandidates(cat.categoryId, name, remainingDays)[0]!);
    }
    candidates.push({
      categoryId: cat.categoryId,
      categoryName: name,
      label: '1日おきにする',
      description: `${name}を1日おきにする`,
      effect: { type: 'scale_rate', factor: 0.5 },
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
    if (isFixedHoliday(date)) factor *= cat.holidayFactor;
    sum += Math.max(0, factor);
  }
  return sum;
}

/** 1カテゴリぶんの、残り期間の変動費を試行回ぶん計算する。 */
function simulateCategoryTrials(
  seed: string,
  cat: CategoryModelParams,
  totalFactor: number,
  trials: number,
  effect: ActionEffect | null,
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
    if (effect?.type === 'reduce_count') {
      expectedCount = Math.max(
        Math.min(expectedCount, MIN_EXPECTED_COUNT),
        expectedCount - effect.count,
      );
    } else if (effect?.type === 'scale_rate') {
      expectedCount *= effect.factor;
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
    for (let i = 0; i < count && historicalAmounts.length > 0; i += 1) {
      total += pickOne(rng, historicalAmounts);
    }
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
  const baseSeed = `${input.periodId}:${input.dataVersion}:actions`;
  const baseById = new Map((input.categoryBases ?? []).map((b) => [b.categoryId, b]));

  const baselineByCategory = new Map<string, Float64Array>();
  const totalFactorById = new Map<string, number>();
  for (const cat of input.fitted.categories) {
    const totalFactor = totalFactorFor(cat, futureDates, input.payday);
    totalFactorById.set(cat.categoryId, totalFactor);
    baselineByCategory.set(
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
  const probWithin = (totals: Float64Array): number | null => {
    if (input.budgetYen === null) return null;
    let within = 0;
    for (const v of totals) if (v <= input.budgetYen) within += 1;
    return within / trials;
  };

  const baselineTotal = sumAcross(baselineByCategory);
  const baselineP50 = quantile(
    Array.from(baselineTotal).sort((a, b) => a - b),
    0.5,
  );
  const baselineProbWithinBudget = probWithin(baselineTotal);

  const results: ActionResult[] = [];
  for (const action of candidates) {
    const cat = input.fitted.categories.find((c) => c.categoryId === action.categoryId);
    const totalFactor = totalFactorById.get(action.categoryId);
    if (cat === undefined || totalFactor === undefined) continue;

    const modified = simulateCategoryTrials(
      `${baseSeed}:cat:${action.categoryId}`,
      cat,
      totalFactor,
      trials,
      action.effect,
    );
    const perCategory = new Map(baselineByCategory);
    perCategory.set(action.categoryId, modified);
    const newTotal = sumAcross(perCategory);
    const newP50 = quantile(
      Array.from(newTotal).sort((a, b) => a - b),
      0.5,
    );
    const newProbWithinBudget = probWithin(newTotal);

    const base = baseById.get(action.categoryId);
    const offset = (base?.actualYen ?? 0) + (base?.scheduledYen ?? 0);
    const catSorted = Array.from(modified).sort((a, b) => a - b);
    const targetYen = input.categoryTargets?.get(action.categoryId) ?? null;
    let probOverTarget: number | null = null;
    if (targetYen !== null) {
      let over = 0;
      for (const v of catSorted) if (offset + v > targetYen) over += 1;
      probOverTarget = over / trials;
    }

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
      category: {
        landing: {
          p10: offset + quantile(catSorted, 0.1),
          p50: offset + quantile(catSorted, 0.5),
          p90: offset + quantile(catSorted, 0.9),
        },
        targetYen,
        probOverTarget,
      },
    });
  }

  return results;
}

/** 効果(確率の改善、無ければ着地額の減り)が大きい順に並べ、最大2件を返す(M5)。 */
export function topActions(results: readonly ActionResult[], max = 2): ActionResult[] {
  return [...results]
    .filter((r) => r.totalDelta < 0 || (r.probDelta ?? 0) > 0)
    .sort((a, b) => {
      if (a.probDelta !== null && b.probDelta !== null && a.probDelta !== b.probDelta) {
        return b.probDelta - a.probDelta;
      }
      return a.totalDelta - b.totalDelta;
    })
    .slice(0, max);
}
