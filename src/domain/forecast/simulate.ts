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

import { eachDay } from '@/domain/period';
import type { DateOnly } from '@/lib/date';
import { rateFactorSum } from './model';
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
  Band,
  CategoryBase,
  FittedModel,
  Forecast,
  ForecastCategoryBand,
  ForecastDriver,
  RegularMerchant,
  VisitEvent,
} from './types';

export const DEFAULT_TRIALS = 10_000;
export const MIN_TRIALS = 2_000;
/** 変動費の記録がこの日数未満なら「学習中」(M3)。 */
export const LEARNING_DATA_DAYS = 14;
/** 安全に使える1日の額が守るべき、予算内に収まる確率の目標。 */
const SAFE_ALLOWANCE_TARGET_PROB = 0.8;

export type CategoryTarget = { categoryId: string; categoryName: string; targetYen: number };

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
  /** カテゴリごとの、予測の前から決まっている額(実績・予定・固定費)。 */
  baseByCategory?: readonly CategoryBase[];
  /** 規則的に通う店の、残り期間の来店の見込み。 */
  visits?: readonly VisitEvent[];
  regularMerchants?: readonly RegularMerchant[];
  /** 目標額のあるカテゴリ。着地がそれを超える確率を出す。 */
  categoryTargets?: readonly CategoryTarget[];
  /**
   * 残りの支出(変動費・規則的な来店・特別費)に掛ける係数。検証で、残りが予測より系統的に
   * 多かった(少なかった)ときの中心の補正(backtest.ts の calibrateCenter)。決まっている額には掛けない。
   */
  remainingScale?: number;
};

function quantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

/** 金額は整数の円で返す(画面の formatYen は整数でないと例外にする、ADR-008)。 */
function bandOf(sortedAsc: readonly number[]): Band {
  return {
    p10: Math.round(quantile(sortedAsc, 0.1)),
    p50: Math.round(quantile(sortedAsc, 0.5)),
    p70: Math.round(quantile(sortedAsc, 0.7)),
    p90: Math.round(quantile(sortedAsc, 0.9)),
  };
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

type TrialRun = {
  trials: number;
  futureDayCount: number;
  /** 予測に出てくるカテゴリ(学習できたもの + 決まっている額・来店・目標だけのもの)。 */
  categories: { id: string; name: string; base: number; target: number | null }[];
  totalSamples: Float64Array;
  specialSamples: Float64Array;
  variableSamples: Float64Array;
  categorySamples: Float64Array[];
  categoryMedian: number[];
};

/** 試行を回す本体。simulateForecast と simulateTotalSamples が共有する(式を2か所に持たない)。 */
function runTrials(input: SimulateInput): TrialRun {
  const futureDates = eachDay(input.today, input.periodTo).filter((d) => d > input.today);
  const fittedCats = input.fitted.categories;
  const nFit = fittedCats.length;

  const extra = new Map<string, { name: string; base: number; target: number | null }>();
  const fittedIds = new Set(fittedCats.map((c) => c.categoryId));
  const touch = (id: string, name: string) => {
    if (fittedIds.has(id)) return undefined;
    const found = extra.get(id) ?? { name, base: 0, target: null };
    extra.set(id, found);
    return found;
  };
  const baseById = new Map<string, number>();
  for (const b of input.baseByCategory ?? []) {
    const yen = b.actualYen + b.scheduledYen + b.fixedYen;
    baseById.set(b.categoryId, (baseById.get(b.categoryId) ?? 0) + yen);
    const e = touch(b.categoryId, b.categoryName);
    if (e) e.base += yen;
  }
  const targetById = new Map<string, number>();
  for (const t of input.categoryTargets ?? []) {
    targetById.set(t.categoryId, t.targetYen);
    const e = touch(t.categoryId, t.categoryName);
    if (e) e.target = t.targetYen;
  }
  for (const v of input.visits ?? []) touch(v.categoryId, v.label);

  const categories = [
    ...fittedCats.map((c) => ({
      id: c.categoryId,
      name: c.categoryName,
      base: baseById.get(c.categoryId) ?? 0,
      target: targetById.get(c.categoryId) ?? null,
    })),
    ...[...extra.entries()].map(([id, e]) => ({
      id,
      name: e.name,
      base: e.base,
      target: e.target,
    })),
  ];
  const nAll = categories.length;
  const indexById = new Map(categories.map((c, i) => [c.id, i]));

  const trials = trialsFor(input.trials ?? DEFAULT_TRIALS, nAll, futureDates.length);
  const rng = createRng(input.seed);
  const scale = input.remainingScale ?? 1;

  // 曜日・給料日・祝日・月の係数は日付だけで決まるので、試行の外で1回だけ計算する。
  // ポアソン分布の加法性(独立なポアソンの和は、率の和のポアソンに従う)を使い、
  // 「日ごとに回数を引く」のではなく「残り期間の合計回数を1回で引く」ことで、
  // 試行ループの内側から日数ぶんのループを無くす。結果の分布は数学的に同一。
  const totalFactorByCategory: number[] = fittedCats.map((cat) =>
    rateFactorSum(cat, futureDates, input.payday, input.fitted.monthFactor),
  );

  const totalSamples = new Float64Array(trials);
  const specialSamples = new Float64Array(trials);
  const variableSamples = new Float64Array(trials);
  const categorySamples: Float64Array[] = categories.map(() => new Float64Array(trials));
  const perCategoryTrial = new Float64Array(nAll);

  // drivers用:各カテゴリの点推定中央値(軽量近似、試行ごとに計算し直さない)。
  const categoryMedian = categories.map((_, i) => {
    const c = fittedCats[i];
    if (c === undefined) return 0;
    const lambdaMean = c.countPosterior.alpha / c.countPosterior.beta;
    const expectedAmount = Math.exp(c.amountPosterior.mu + c.amountPosterior.sigmaSq / 2);
    return lambdaMean * futureDates.length * expectedAmount;
  });

  const dayBundles = input.fitted.dayBundles;
  const categoryIds = fittedCats.map((c) => c.categoryId);
  const visits = (input.visits ?? [])
    .map((v) => ({ v, index: indexById.get(v.categoryId) }))
    .filter((x): x is { v: VisitEvent; index: number } => x.index !== undefined);

  for (let t = 0; t < trials; t += 1) {
    perCategoryTrial.fill(0);
    let variableTotal = 0;
    const useBootstrap = input.bootstrapWeight > 0 && rng() < input.bootstrapWeight;

    if (useBootstrap && dayBundles.length > 0) {
      for (let d = 0; d < futureDates.length; d += 1) {
        const bundle = pickWeighted(rng, dayBundles, (b) => b.weight);
        for (let c = 0; c < nFit; c += 1) {
          const amount = bundle.amountsByCategory.get(categoryIds[c]!) ?? 0;
          perCategoryTrial[c]! += amount;
          variableTotal += amount;
        }
      }
    } else {
      for (let c = 0; c < nFit; c += 1) {
        const cat = fittedCats[c]!;
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

    // 規則的に通う店:来店の日ごとに、来るかどうかと金額を引く。
    for (const { v, index } of visits) {
      if (rng() >= v.probability) continue;
      const amount = sampleLognormal(rng, v.logMu, v.logSigma);
      perCategoryTrial[index]! += amount;
      variableTotal += amount;
    }

    const specialTotal = sampleSpecial(
      rng,
      input.specialHistoricalAmounts,
      input.specialOccurrencesPerDay,
      input.remainingDays,
    );

    totalSamples[t] = input.actualYen + input.committedYen + (variableTotal + specialTotal) * scale;
    specialSamples[t] = specialTotal * scale;
    variableSamples[t] = variableTotal * scale;
    for (let c = 0; c < nAll; c += 1) categorySamples[c]![t] = perCategoryTrial[c]! * scale;
  }

  return {
    trials,
    futureDayCount: futureDates.length,
    categories,
    totalSamples,
    specialSamples,
    variableSamples,
    categorySamples,
    categoryMedian,
  };
}

export function simulateForecast(input: SimulateInput): Forecast {
  const run = runTrials(input);
  const { trials, categories, totalSamples, specialSamples, variableSamples, categorySamples } =
    run;
  const nAll = categories.length;

  // 予算を超えた試行での、各カテゴリの「ふだんより多い分」(原因の割り当て)。
  const overshootByCategory = new Float64Array(nAll);
  let overshootTrialCount = 0;
  if (input.budgetYen !== null) {
    for (let t = 0; t < trials; t += 1) {
      if (totalSamples[t]! <= input.budgetYen) continue;
      overshootTrialCount += 1;
      for (let c = 0; c < nAll; c += 1) {
        overshootByCategory[c]! += Math.max(0, categorySamples[c]![t]! - run.categoryMedian[c]!);
      }
    }
  }

  const sortedTotal = Array.from(totalSamples).sort((a, b) => a - b);
  const sortedSpecial = Array.from(specialSamples).sort((a, b) => a - b);
  let sumTotal = 0;
  for (let t = 0; t < trials; t += 1) sumTotal += totalSamples[t]!;

  const baseDetail = new Map<string, { actual: number; scheduled: number; fixed: number }>();
  for (const b of input.baseByCategory ?? []) {
    const d = baseDetail.get(b.categoryId) ?? { actual: 0, scheduled: 0, fixed: 0 };
    d.actual += b.actualYen;
    d.scheduled += b.scheduledYen;
    d.fixed += b.fixedYen;
    baseDetail.set(b.categoryId, d);
  }
  const byCategory: ForecastCategoryBand[] = categories.map((cat, c) => {
    const detail = baseDetail.get(cat.id) ?? { actual: 0, scheduled: 0, fixed: 0 };
    const variableSorted = Array.from(categorySamples[c]!).sort((a, b) => a - b);
    const landingSorted = variableSorted.map((v) => v + cat.base);
    let over = 0;
    if (cat.target !== null) {
      for (let t = 0; t < trials; t += 1)
        if (cat.base + categorySamples[c]![t]! > cat.target) over += 1;
    }
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      p10: Math.round(quantile(variableSorted, 0.1)),
      p50: Math.round(quantile(variableSorted, 0.5)),
      p90: Math.round(quantile(variableSorted, 0.9)),
      landing: bandOf(landingSorted),
      baseYen: cat.base,
      actualYen: detail.actual,
      scheduledYen: detail.scheduled,
      fixedYen: detail.fixed,
      targetYen: cat.target,
      exceedance: cat.target === null ? null : over / trials,
    };
  });

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
            categoryId: cat.id,
            categoryName: cat.name,
            shareOfRisk: overshootByCategory[c]! / totalOvershootRisk,
          }))
          .filter((d) => d.shareOfRisk > 0)
          .sort((a, b) => b.shareOfRisk - a.shareOfRisk)
      : [];

  const safeDailyAllowance =
    input.budgetYen !== null && run.futureDayCount > 0
      ? findSafeDailyAllowance({
          budgetYen: input.budgetYen,
          fixedPart: (i: number) => input.actualYen + input.committedYen + specialSamples[i]!,
          variableSamples,
          remainingDays: run.futureDayCount,
        })
      : null;

  const visitExpected = (input.visits ?? []).reduce(
    (sum, v) => sum + v.probability * Math.exp(v.logMu + v.logSigma ** 2 / 2),
    0,
  );

  return {
    periodId: input.periodId,
    asOf: input.today,
    remainingDays: input.remainingDays,
    total: { ...bandOf(sortedTotal), mean: Math.round(sumTotal / trials) },
    byCategory,
    committed: { scheduledYen: 0, fixedYen: 0 }, // 呼び出し側(engine.ts)が上書きする
    visits: {
      expectedYen: Math.round(visitExpected),
      merchants: (input.regularMerchants ?? []).map((m) => ({
        label: m.label,
        everyDays: m.everyDays,
        probability: m.probability,
        meanYen: Math.round(m.meanYen),
      })),
    },
    seasonal: { active: input.fitted.seasonal, periodFactor: null }, // engine.ts が期間の月の係数を入れる
    special: {
      expected: Math.round(sortedSpecial.reduce((a, b) => a + b, 0) / trials),
      p90: Math.round(quantile(sortedSpecial, 0.9)),
    },
    probWithinBudget,
    expectedOvershoot: Math.round(expectedOvershoot),
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
 * simulateForecast() と同じ試行のうち、合計額の生のサンプルだけを返す
 * (M4のバックテストで CRPS を計算するために使う)。同じ seed・同じ入力なら
 * simulateForecast() の total と整合する。
 */
export function simulateTotalSamples(input: SimulateInput): Float64Array {
  return runTrials(input).totalSamples;
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
