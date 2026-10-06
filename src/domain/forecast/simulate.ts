/**
 * M3:モンテカルロ・シミュレーション。残り期間を既定10,000通り試行し、
 * 着地額の分布(p10/p50/p90)・予算内に収まる確率・超える場合の原因・
 * 安全に使える1日の額を求める。
 *
 * 決定論:乱数は (periodId, データのバージョン) から作ったシード文字列を
 * domain/forecast/rng.ts の createRng() に渡すだけで、Math.random() は
 * 一切使わない。同じ入力なら必ず同じ結果になる。
 *
 * 「処理時間が200msを超える端末では試行回数を減らす」という本人要件は、
 * このアプリの既存の集計がすべてサーバー側(Reactサーバーコンポーネント/
 * サーバーアクション)で計算されクライアントのUIスレッドを占有しない設計
 * (summarizeLedger()・planGuidance() 等と同じ)であるため、この関数を
 * クライアント端末の性能で分岐させると「同じデータなら何度開いても同じ
 * 数字」という約束(M3原則5)と両立しない。既定の試行回数は固定の10,000回
 * とし、性能はサーバー側の実測(M7の性能テスト)で担保する方針にした
 * (判断、docs/decisions.md 参照)。trials は呼び出し側が明示的に下げる
 * (例:テスト・簡易プレビュー)ことはできる。
 *
 * 性能:曜日・給料日・祝日の係数は日付だけで決まり試行に依存しないため、
 * 試行ループの外で1回だけ計算しておく(1万試行 × 日数 の中で毎回
 * Date を作り直すと極端に遅くなることを実測で確認した)。
 */

import { weekdayOf, type DateOnly } from '@/lib/date';
import { eachDay } from '@/domain/period';
import { isFixedHoliday } from './holidays';
import { isPaydayWindow } from './model';
import {
  createRng,
  pickOne,
  pickWeighted,
  sampleGamma,
  sampleLognormal,
  samplePoisson,
  sampleStandardNormal,
  type Rng,
} from './rng';
import type {
  CategoryPeriodBase,
  FittedModel,
  Forecast,
  ForecastCategoryBand,
  ForecastDriver,
} from './types';

export const DEFAULT_TRIALS = 10_000;
export const MIN_TRIALS = 2_000;
/** 変動費の記録がこの日数未満なら「学習中」(M3)。 */
export const LEARNING_DATA_DAYS = 14;
/** 安全に使える1日の額が守るべき、予算内に収まる確率の目標。 */
const SAFE_ALLOWANCE_TARGET_PROB = 0.8;

export type SimulateInput = {
  periodId: string;
  today: DateOnly;
  periodTo: DateOnly;
  remainingDays: number;
  fitted: FittedModel;
  /** 確定分(予定支出 + 残り期間の固定費)。試行によらず一定。 */
  committedYen: number;
  /** 今日までの実績(通常支出)。試行によらず一定。 */
  actualYen: number;
  specialHistoricalAmounts: readonly number[];
  specialOccurrencesPerDay: number;
  budgetYen: number | null;
  payday: number | null;
  /** 0=ベイズモデルのみ、1=ブロック・ブートストラップのみ(M4が決める)。 */
  bootstrapWeight: number;
  trials?: number;
  seed: string;
  /** カテゴリ別の期間内の実績・予定(着地額の土台)。 */
  categoryBases?: readonly CategoryPeriodBase[];
  /** カテゴリ別の目標(予算)。目標超えの確率に使う。 */
  categoryTargets?: ReadonlyMap<string, number>;
};

function quantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

function sampleSpecial(
  rng: Rng,
  historicalAmounts: readonly number[],
  occurrencesPerDay: number,
  remainingDays: number,
): number {
  const count = samplePoisson(rng, occurrencesPerDay * remainingDays);
  if (count === 0 || historicalAmounts.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += pickOne(rng, historicalAmounts);
  return total;
}

/**
 * データが大きい(カテゴリ数×残り日数が大きい)ときだけ試行回数を減らす
 * (M3「処理時間が200msを超える端末では、試行回数を減らす」)。実行環境の
 * 速さでは分岐させない——データが同じなら常に同じ試行回数になり、結果も
 * 変わらない(M3原則5の決定論を保つ)。1試行あたりのコストはおおよそ
 * カテゴリ数×残り日数に比例するため、その積に応じて減らす。
 */
/** 「4カテゴリ×30日」相当までは既定の試行回数(10,000)のまま動かす基準値。 */
const REFERENCE_WORKLOAD = 120;

function trialsFor(requested: number, categoryCount: number, remainingDayCount: number): number {
  const workload = Math.max(1, categoryCount * remainingDayCount);
  const scaled = Math.floor((REFERENCE_WORKLOAD / workload) * DEFAULT_TRIALS);
  return Math.max(MIN_TRIALS, Math.min(requested, scaled));
}

export function simulateForecast(input: SimulateInput): Forecast {
  const futureDates = eachDay(input.today, input.periodTo).filter((d) => d > input.today);
  const categories = input.fitted.categories;
  const nCat = categories.length;
  const trials = trialsFor(input.trials ?? DEFAULT_TRIALS, nCat, futureDates.length);
  const rng = createRng(input.seed);

  // 曜日・給料日・祝日の係数は日付だけで決まるので、試行の外で1回だけ計算する。
  // ポアソン分布の加法性(独立なポアソンの和は、率の和のポアソンに従う)を使い、
  // 「日ごとに回数を引く」のではなく「残り期間の合計回数を1回で引く」ことで、
  // 試行ループの内側から日数ぶんのループを無くす(1万試行×12カテゴリ×31日の
  // 3重ループが遅すぎた実測を踏まえた最適化。結果の分布は数学的に同一)。
  const totalFactorByCategory: number[] = categories.map((cat) =>
    futureDates.reduce((sum, date) => {
      const wd = weekdayOf(date);
      let factor = cat.weekdayFactor[wd] ?? 1;
      if (input.payday !== null && isPaydayWindow(date, input.payday)) factor *= cat.paydayFactor;
      if (isFixedHoliday(date)) factor *= cat.holidayFactor;
      return sum + Math.max(0, factor);
    }, 0),
  );

  const totalSamples = new Float64Array(trials);
  const specialSamples = new Float64Array(trials);
  const variableSamples = new Float64Array(trials);
  const categorySamples: Float64Array[] = categories.map(() => new Float64Array(trials));
  const perCategoryTrial = new Float64Array(nCat);

  // drivers用:各カテゴリの点推定中央値(軽量近似、試行ごとに計算し直さない)。
  const categoryMedian = categories.map((c) => {
    const lambdaMean = c.countPosterior.alpha / c.countPosterior.beta;
    const expectedAmount = Math.exp(c.amountPosterior.mu + c.amountPosterior.sigmaSq / 2);
    return lambdaMean * futureDates.length * expectedAmount;
  });
  const overshootByCategory = new Float64Array(nCat);
  let overshootTrialCount = 0;

  const dayBundles = input.fitted.dayBundles;
  const categoryIds = categories.map((c) => c.categoryId);

  for (let t = 0; t < trials; t += 1) {
    perCategoryTrial.fill(0);
    let variableTotal = 0;
    const useBootstrap = input.bootstrapWeight > 0 && rng() < input.bootstrapWeight;

    if (useBootstrap && dayBundles.length > 0) {
      for (let d = 0; d < futureDates.length; d += 1) {
        const bundle = pickWeighted(rng, dayBundles, (b) => b.weight);
        for (let c = 0; c < nCat; c += 1) {
          const amount = bundle.amountsByCategory.get(categoryIds[c]!) ?? 0;
          perCategoryTrial[c]! += amount;
          variableTotal += amount;
        }
      }
    } else {
      for (let c = 0; c < nCat; c += 1) {
        const cat = categories[c]!;
        const lambda = sampleGamma(rng, cat.countPosterior.alpha, 1 / cat.countPosterior.beta);
        const muTrial =
          cat.amountPosterior.mu +
          Math.sqrt(cat.amountPosterior.sigmaSq / Math.max(cat.amountPosterior.kappa, 0.01)) *
            sampleStandardNormal(rng);
        const sigma = Math.sqrt(cat.amountPosterior.sigmaSq);

        const count = samplePoisson(rng, lambda * totalFactorByCategory[c]!);
        let catTotal = 0;
        for (let i = 0; i < count; i += 1) catTotal += sampleLognormal(rng, muTrial, sigma);
        perCategoryTrial[c] = catTotal;
        variableTotal += catTotal;
      }
    }

    const specialTotal = sampleSpecial(
      rng,
      input.specialHistoricalAmounts,
      input.specialOccurrencesPerDay,
      input.remainingDays,
    );

    const total = input.actualYen + input.committedYen + variableTotal + specialTotal;
    totalSamples[t] = total;
    specialSamples[t] = specialTotal;
    variableSamples[t] = variableTotal;
    for (let c = 0; c < nCat; c += 1) categorySamples[c]![t] = perCategoryTrial[c]!;

    if (input.budgetYen !== null && total > input.budgetYen) {
      overshootTrialCount += 1;
      for (let c = 0; c < nCat; c += 1) {
        const over = Math.max(0, perCategoryTrial[c]! - categoryMedian[c]!);
        overshootByCategory[c]! += over;
      }
    }
  }

  const sortedTotal = Array.from(totalSamples).sort((a, b) => a - b);
  const sortedSpecial = Array.from(specialSamples).sort((a, b) => a - b);
  let sumTotal = 0;
  for (let t = 0; t < trials; t += 1) sumTotal += totalSamples[t]!;
  const mean = sumTotal / trials;

  const baseById = new Map((input.categoryBases ?? []).map((b) => [b.categoryId, b]));
  const bandFor = (
    categoryId: string,
    categoryName: string,
    samples: Float64Array | null,
  ): ForecastCategoryBand => {
    const sorted = samples ? Array.from(samples).sort((a, b) => a - b) : [0];
    const base = baseById.get(categoryId);
    const actualYen = base?.actualYen ?? 0;
    const scheduledYen = base?.scheduledYen ?? 0;
    const offset = actualYen + scheduledYen;
    const targetYen = input.categoryTargets?.get(categoryId) ?? null;
    let probOverTarget: number | null = null;
    if (targetYen !== null) {
      let over = 0;
      for (const v of sorted) if (offset + v > targetYen) over += 1;
      probOverTarget = over / sorted.length;
    }
    const p10 = quantile(sorted, 0.1);
    const p50 = quantile(sorted, 0.5);
    const p90 = quantile(sorted, 0.9);
    return {
      categoryId,
      categoryName,
      p10,
      p50,
      p90,
      actualYen,
      scheduledYen,
      landing: { p10: offset + p10, p50: offset + p50, p90: offset + p90 },
      targetYen,
      probOverTarget,
    };
  };
  const byCategory = categories.map((cat, c) =>
    bandFor(cat.categoryId, cat.categoryName, categorySamples[c]!),
  );
  // 学習データに無く、今期の予定だけがあるカテゴリも着地額に含める。
  const modeled = new Set(categories.map((c) => c.categoryId));
  for (const base of input.categoryBases ?? []) {
    if (!modeled.has(base.categoryId)) {
      byCategory.push(bandFor(base.categoryId, base.categoryName, null));
    }
  }

  const probWithinBudget = input.budgetYen !== null ? 1 - overshootTrialCount / trials : null;
  const expectedOvershoot =
    input.budgetYen !== null && overshootTrialCount > 0
      ? sortedTotal
          .filter((v) => v > (input.budgetYen ?? Infinity))
          .reduce((sum, v) => sum + (v - (input.budgetYen ?? 0)), 0) / overshootTrialCount
      : 0;

  const totalOvershootRisk = overshootByCategory.reduce((a, b) => a + b, 0);
  const drivers: ForecastDriver[] =
    totalOvershootRisk > 0
      ? categories
          .map((cat, c) => ({
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            shareOfRisk: overshootByCategory[c]! / totalOvershootRisk,
          }))
          .filter((d) => d.shareOfRisk > 0)
          .sort((a, b) => b.shareOfRisk - a.shareOfRisk)
      : [];

  const safeDailyAllowance =
    input.budgetYen !== null && futureDates.length > 0
      ? findSafeDailyAllowance({
          budgetYen: input.budgetYen,
          fixedPart: (i: number) => input.actualYen + input.committedYen + specialSamples[i]!,
          variableSamples,
          remainingDays: futureDates.length,
        })
      : null;

  return {
    periodId: input.periodId,
    asOf: input.today,
    remainingDays: input.remainingDays,
    total: {
      p10: quantile(sortedTotal, 0.1),
      p50: quantile(sortedTotal, 0.5),
      p90: quantile(sortedTotal, 0.9),
      mean,
    },
    byCategory,
    committed: { scheduledYen: 0, fixedYen: 0 }, // 呼び出し側(engine.ts)が上書きする
    special: {
      expected: sortedSpecial.reduce((a, b) => a + b, 0) / trials,
      p90: quantile(sortedSpecial, 0.9),
    },
    probWithinBudget,
    expectedOvershoot,
    drivers,
    safeDailyAllowance,
    status: input.fitted.dataDays < LEARNING_DATA_DAYS ? 'learning' : 'ready',
    dataDays: input.fitted.dataDays,
    method:
      input.bootstrapWeight <= 0 ? 'bayes' : input.bootstrapWeight >= 1 ? 'bootstrap' : 'ensemble',
    calibration: null, // M4が埋める
  };
}

/**
 * simulateForecast() と同じ計算のうち、合計額の生の試行サンプルだけを返す
 * 軽量版(M4のバックテストで CRPS を計算するために使う。カテゴリ別内訳・
 * drivers・安全額は使わないため省く)。同じ seed・同じ入力なら
 * simulateForecast() の total.p10/p50/p90 と整合する値になる。
 */
export function simulateTotalSamples(input: SimulateInput): Float64Array {
  const futureDates = eachDay(input.today, input.periodTo).filter((d) => d > input.today);
  const categories = input.fitted.categories;
  const nCat = categories.length;
  const trials = trialsFor(input.trials ?? DEFAULT_TRIALS, nCat, futureDates.length);
  const rng = createRng(input.seed);

  const totalFactorByCategory: number[] = categories.map((cat) =>
    futureDates.reduce((sum, date) => {
      const wd = weekdayOf(date);
      let factor = cat.weekdayFactor[wd] ?? 1;
      if (input.payday !== null && isPaydayWindow(date, input.payday)) factor *= cat.paydayFactor;
      if (isFixedHoliday(date)) factor *= cat.holidayFactor;
      return sum + Math.max(0, factor);
    }, 0),
  );

  const dayBundles = input.fitted.dayBundles;
  const categoryIds = categories.map((c) => c.categoryId);
  const totalSamples = new Float64Array(trials);

  for (let t = 0; t < trials; t += 1) {
    let variableTotal = 0;
    const useBootstrap = input.bootstrapWeight > 0 && rng() < input.bootstrapWeight;

    if (useBootstrap && dayBundles.length > 0) {
      for (let d = 0; d < futureDates.length; d += 1) {
        const bundle = pickWeighted(rng, dayBundles, (b) => b.weight);
        for (let c = 0; c < nCat; c += 1)
          variableTotal += bundle.amountsByCategory.get(categoryIds[c]!) ?? 0;
      }
    } else {
      for (let c = 0; c < nCat; c += 1) {
        const cat = categories[c]!;
        const lambda = sampleGamma(rng, cat.countPosterior.alpha, 1 / cat.countPosterior.beta);
        const muTrial =
          cat.amountPosterior.mu +
          Math.sqrt(cat.amountPosterior.sigmaSq / Math.max(cat.amountPosterior.kappa, 0.01)) *
            sampleStandardNormal(rng);
        const sigma = Math.sqrt(cat.amountPosterior.sigmaSq);
        const count = samplePoisson(rng, lambda * totalFactorByCategory[c]!);
        for (let i = 0; i < count; i += 1) variableTotal += sampleLognormal(rng, muTrial, sigma);
      }
    }

    const specialTotal = sampleSpecial(
      rng,
      input.specialHistoricalAmounts,
      input.specialOccurrencesPerDay,
      input.remainingDays,
    );
    totalSamples[t] = input.actualYen + input.committedYen + variableTotal + specialTotal;
  }

  return totalSamples;
}

/**
 * 変動費全体に係数kを掛けたとき、予算内に収まる確率がちょうど80%になるkを
 * 二分探索で求める(M3)。(k × 変動費の1日あたりの期待値)を安全に使える額とする。
 */
function findSafeDailyAllowance(input: {
  budgetYen: number;
  fixedPart: (trialIndex: number) => number;
  variableSamples: Float64Array;
  remainingDays: number;
}): number {
  const n = input.variableSamples.length;
  const probAt = (k: number): number => {
    let within = 0;
    for (let i = 0; i < n; i += 1) {
      if (input.fixedPart(i) + k * input.variableSamples[i]! <= input.budgetYen) within += 1;
    }
    return within / n;
  };

  let lo = 0;
  let hi = 3;
  // k=0(変動費を一切使わない)でも80%に届かないなら、安全な額は無い(0円)。
  if (probAt(0) < SAFE_ALLOWANCE_TARGET_PROB) return 0;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (probAt(mid) >= SAFE_ALLOWANCE_TARGET_PROB) lo = mid;
    else hi = mid;
  }
  let sumVariable = 0;
  for (let i = 0; i < n; i += 1) sumVariable += input.variableSamples[i]!;
  const meanVariable = sumVariable / Math.max(1, n);
  const dailyVariableMean = meanVariable / Math.max(1, input.remainingDays);
  return Math.max(0, Math.round(lo * dailyVariableMean));
}
