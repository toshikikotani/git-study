/**
 * モンテカルロ・シミュレーション。残り期間を何千通りも試し、着地の分布・予算に収まる確率・
 * 超える場合の原因・安全に使える1日の額・グラフの日ごとの線と帯を、すべて同じ試行から出す
 * (画面ごとに別の計算をしないので、見出しとグラフがずれない)。
 *
 * 1試行の中身:
 *   - カテゴリごとに回数の率 λ と、今月の金額の中心 μ を引く
 *   - 今月の水準 L ~ Gamma(k + 今月の回数, k + 今月の期待回数)(全カテゴリ共通)
 *   - 'paths' は残りの各日の回数と金額を引き、日ごとに足す。'totals' は残り期間の回数を
 *     休み・平日ごとに1回で引く(ポアソンの和の性質で分布は同じ。検証で速く回すため)
 *   - まだ記録されていない支出(入力の遅れ)、規則的な来店、月払いの請求、特別費、
 *     日付の決まった予定・固定費を足す
 *
 * 決定論:乱数は (期間, データの版) から作ったシードで決まる。同じ入力なら同じ結果になる。
 */

import { eachDay } from '@/domain/period';
import { daysBetween, type DateOnly } from '@/lib/date';
import { recordedShare } from './lag';
import { dayFeature, DEFAULT_MONTH_LEVEL_K, rateFactor } from './model';
import { calibratedProbability, rawLevelFor, type PitCalibration } from './pit';
import {
  createRng,
  pickOne,
  sampleGamma,
  sampleLognormal,
  samplePoisson,
  sampleStandardNormal,
} from './rng';
import type {
  Band,
  CategoryBase,
  DatedEvent,
  FittedModel,
  Forecast,
  ForecastCategoryBand,
  ForecastDriver,
  MonthlyBill,
  PathPoint,
  PeriodObservation,
  ProbableEvent,
  RegularMerchant,
  TypicalProfilePoint,
} from './types';

export const DEFAULT_TRIALS = 10_000;
export const MIN_TRIALS = 2_000;
/** 変動費の記録がこの日数未満なら「学習中」。 */
export const LEARNING_DATA_DAYS = 14;
/** 安全に使える1日の額が守るべき、予算内に収まる確率の目標。 */
const SAFE_ALLOWANCE_TARGET_PROB = 0.8;

export type CategoryTarget = { categoryId: string; categoryName: string; targetYen: number };

export type SimulateInput = {
  periodId: string;
  today: DateOnly;
  periodFrom: DateOnly;
  periodTo: DateOnly;
  remainingDays: number;
  fitted: FittedModel;
  payday: number | null;
  /** 今日までの実績(特別費を含み、返金を差し引いた額)。 */
  actualYen: number;
  /** 残り期間の、日付の決まった支払い(予定・確認済みの固定費)。 */
  events?: readonly DatedEvent[];
  specialHistoricalAmounts: readonly number[];
  specialOccurrencesPerDay: number;
  budgetYen: number | null;
  trials?: number;
  seed: string;
  /** カテゴリごとの、予測の前から決まっている額(実績・予定・固定費)。 */
  baseByCategory?: readonly CategoryBase[];
  /** 規則的に通う店の、残り期間の来店の見込み。 */
  visits?: readonly ProbableEvent[];
  regularMerchants?: readonly RegularMerchant[];
  /** 月払いの請求の、残り期間の見込み。 */
  billEvents?: readonly ProbableEvent[];
  bills?: readonly MonthlyBill[];
  /** 期間に入ってからの変動費の記録(今月の水準と金額の更新)。 */
  periodObservations?: readonly PeriodObservation[];
  /** 期間の初日〜今日のうち、記録のある日。 */
  elapsedDates?: readonly DateOnly[];
  /** 入力の遅れ D(j)。無ければ遅れなし。 */
  entryLag?: readonly number[] | null;
  /** 今月の水準の事前分布の強さ k(Infinity なら今月の水準を見ない)。 */
  monthLevelK?: number;
  /** 期間に入ってからの記録で今月の水準を更新するか(false なら事前分布 Gamma(k, k) のまま)。 */
  levelUpdate?: boolean;
  /** 目標額のあるカテゴリ。着地がそれを超える確率を出す。 */
  categoryTargets?: readonly CategoryTarget[];
  /**
   * 残りの支出(変動費・来店・特別費・未記録)に掛ける中心の補正係数(検証の時点帯ごと)。
   * 決まっている額と請求には掛けない。
   */
  remainingScale?: number;
  /** 確率の補正(PIT)。無ければ生の分位をそのまま使う。 */
  calibration?: PitCalibration | null;
  /** 'paths' は日ごとに引く(グラフの線と帯を出す)。'totals' は合計だけ(検証用、速い)。 */
  mode?: 'paths' | 'totals';
};

function quantileAt(sortedAsc: ArrayLike<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
  return sortedAsc[idx]!;
}

/**
 * データが大きい(カテゴリ数×残り日数が大きい)ときだけ試行回数を減らす。実行環境の速さでは
 * 分岐させない(データが同じなら常に同じ試行回数・同じ結果)。
 */
const REFERENCE_WORKLOAD = 120;
function trialsFor(requested: number, categoryCount: number, remainingDayCount: number): number {
  const workload = Math.max(1, categoryCount * remainingDayCount);
  const scaled = Math.floor((REFERENCE_WORKLOAD / workload) * DEFAULT_TRIALS);
  return Math.max(Math.min(requested, MIN_TRIALS), Math.min(requested, scaled));
}

type CategoryRow = { id: string; name: string; base: number; target: number | null };

export type TrialRun = {
  trials: number;
  futureDates: readonly DateOnly[];
  categories: CategoryRow[];
  /** 着地(実績 + 決まっている額 + 残り)。 */
  totalSamples: Float64Array;
  /** 'paths' のときだけ:試行 t の、今日の翌日から d 日目までの累計の増分(t × 日数 + d)。 */
  pathIncrements: Float64Array | null;
  specialSamples: Float64Array;
  /** 本人が加減できる部分(変動費 + 来店)。安全に使える1日の額に使う。 */
  variableSamples: Float64Array;
  categorySamples: Float64Array[];
  unrecordedSamples: Float64Array;
  eventsYen: number;
};

/** 試行を回す本体。本番(simulateForecast)と検証(simulateTotalSamples)が共有する。 */
export function runTrials(input: SimulateInput): TrialRun {
  const mode = input.mode ?? 'paths';
  const futureDates = eachDay(input.today, input.periodTo).filter(
    (d) => d > input.today && d >= input.periodFrom,
  );
  const D = futureDates.length;
  const dayIndex = new Map(futureDates.map((d, i) => [d, i]));
  const fittedCats = input.fitted.categories;
  const nFit = fittedCats.length;

  // 予測に出てくるカテゴリ(学習できたもの + 決まっている額・来店・請求・目標だけのもの)。
  const extra = new Map<string, CategoryRow>();
  const fittedIds = new Set(fittedCats.map((c) => c.categoryId));
  const touch = (id: string, name: string): CategoryRow | undefined => {
    if (fittedIds.has(id)) return undefined;
    const found = extra.get(id) ?? { id, name, base: 0, target: null };
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
  for (const v of [...(input.visits ?? []), ...(input.billEvents ?? [])])
    touch(v.categoryId, v.label);

  const categories: CategoryRow[] = [
    ...fittedCats.map((c) => ({
      id: c.categoryId,
      name: c.categoryName,
      base: baseById.get(c.categoryId) ?? 0,
      target: targetById.get(c.categoryId) ?? null,
    })),
    ...extra.values(),
  ];
  const nAll = categories.length;
  const indexById = new Map(categories.map((c, i) => [c.id, i]));

  const trials = trialsFor(input.trials ?? DEFAULT_TRIALS, nAll, Math.max(1, D));
  const rng = createRng(input.seed);
  const scale = input.remainingScale ?? 1;
  const k = input.monthLevelK ?? DEFAULT_MONTH_LEVEL_K;
  const lag = input.entryLag ?? null;
  const elapsed = input.elapsedDates ?? [];
  const obsById = new Map((input.periodObservations ?? []).map((o) => [o.categoryId, o]));
  const levelUpdate = input.levelUpdate ?? true;
  let observedCount = 0;
  if (levelUpdate) for (const o of obsById.values()) observedCount += o.count;

  // 日付だけで決まる係数は、試行の外で1回だけ計算する。
  const futureOff = futureDates.map((d) => dayFeature(d, input.payday).dayOff);
  const pre = fittedCats.map((cat) => {
    const factors = new Float64Array(D);
    let sumOff = 0;
    let sumOn = 0;
    for (let d = 0; d < D; d += 1) {
      const f = rateFactor(cat, futureDates[d]!, input.payday, input.fitted.monthFactor);
      factors[d] = f;
      if (futureOff[d]) sumOff += f;
      else sumOn += f;
    }
    // 今日までの期待回数のうち、記録された分(水準の更新の分母)と、まだ記録されていない分。
    let exposure = 0;
    let unrecorded = 0;
    let unrecordedOff = 0;
    for (const date of elapsed) {
      const f = rateFactor(cat, date, input.payday, input.fitted.monthFactor);
      const share = recordedShare(lag, daysBetween(date, input.today));
      exposure += f * share;
      unrecorded += f * (1 - share);
      if (dayFeature(date, input.payday).dayOff) unrecordedOff += f * (1 - share);
    }
    // 今月の金額の中心:μ_今月 = μ + v(今月の平均 − μ)、v = mτ² ÷ (mτ² + σ²_月内)。
    const { mu, sigmaSq, kappa } = cat.amountPosterior;
    const tauSq = Math.min(cat.monthTauSq, sigmaSq * 0.8);
    const withinSq = Math.max(0.05, sigmaSq - tauSq);
    const obs = obsById.get(cat.categoryId);
    const m = obs?.logAmounts.length ?? 0;
    const meanLog = m > 0 ? obs!.logAmounts.reduce((a, b) => a + b, 0) / m : mu;
    const v = m > 0 ? (m * tauSq) / (m * tauSq + withinSq) : 0;
    return {
      factors,
      sumOff,
      sumOn,
      exposure,
      unrecorded,
      unrecordedOff,
      muMonth: mu + v * (meanLog - mu),
      muSd: Math.sqrt(sigmaSq / Math.max(kappa, 0.01) + (1 - v) * tauSq),
      sigmaWithin: Math.sqrt(withinSq),
    };
  });

  const eventsByDay = new Float64Array(Math.max(1, D));
  let eventsYen = 0;
  for (const e of input.events ?? []) {
    const d = dayIndex.get(e.date);
    if (d === undefined) continue;
    eventsByDay[d]! += e.amountYen;
    eventsYen += e.amountYen;
  }
  const probable = (events: readonly ProbableEvent[] | undefined, scaled: boolean) =>
    (events ?? [])
      .map((e) => ({ e, day: dayIndex.get(e.date), index: indexById.get(e.categoryId), scaled }))
      .filter(
        (x): x is { e: ProbableEvent; day: number; index: number; scaled: boolean } =>
          x.day !== undefined && x.index !== undefined,
      );
  const probableEvents = [...probable(input.visits, true), ...probable(input.billEvents, false)];
  // 規則的に通う店の、もう行ったがまだ記録されていない来店(入力の遅れ)。1日あたりの来店の率
  // (確率 ÷ 間隔)に、今日までの各日のまだ記録されていない割合を掛けて足す。
  const unrecordedVisits = (input.regularMerchants ?? [])
    .map((m) => {
      let expected = 0;
      for (const date of elapsed) {
        expected +=
          (m.probability / m.everyDays) * (1 - recordedShare(lag, daysBetween(date, input.today)));
      }
      return { m, expected, index: indexById.get(m.categoryId) };
    })
    .filter(
      (x): x is { m: RegularMerchant; expected: number; index: number } =>
        x.expected > 0 && x.index !== undefined,
    );

  const totalSamples = new Float64Array(trials);
  const specialSamples = new Float64Array(trials);
  const variableSamples = new Float64Array(trials);
  const unrecordedSamples = new Float64Array(trials);
  const categorySamples: Float64Array[] = categories.map(() => new Float64Array(trials));
  const pathIncrements = mode === 'paths' && D > 0 ? new Float64Array(trials * D) : null;
  const dayTotals = new Float64Array(Math.max(1, D));
  const lambdas = new Float64Array(nFit);

  for (let t = 0; t < trials; t += 1) {
    dayTotals.set(eventsByDay);
    let variableTotal = 0;
    let unrecordedTotal = 0;
    let billTotal = 0;

    for (let c = 0; c < nFit; c += 1) {
      const post = fittedCats[c]!.countPosterior;
      lambdas[c] = sampleGamma(rng, post.alpha, 1 / post.beta);
    }
    let level = 1;
    if (Number.isFinite(k) && k > 0) {
      let expected = 0;
      if (levelUpdate) for (let c = 0; c < nFit; c += 1) expected += lambdas[c]! * pre[c]!.exposure;
      level = sampleGamma(rng, k + observedCount, 1 / (k + expected));
    }

    for (let c = 0; c < nFit; c += 1) {
      const cat = fittedCats[c]!;
      const p = pre[c]!;
      const rate = lambdas[c]! * level;
      const muTrial = p.muMonth + p.muSd * sampleStandardNormal(rng);
      const sigma = p.sigmaWithin;
      // 休みの日(土日祝)と平日で、1回の金額が違う(居酒屋は休みの日に多く、高い)。
      const { delta, share } = cat.dayOffAmount;
      const muOff = muTrial + (1 - share) * delta;
      const muOn = muTrial - share * delta;
      let catTotal = 0;
      if (pathIncrements !== null) {
        for (let d = 0; d < D; d += 1) {
          const count = samplePoisson(rng, rate * p.factors[d]!);
          if (count === 0) continue;
          const mu = futureOff[d] ? muOff : muOn;
          let dayYen = 0;
          for (let i = 0; i < count; i += 1) dayYen += sampleLognormal(rng, mu, sigma);
          dayTotals[d]! += dayYen * scale;
          catTotal += dayYen;
        }
      } else {
        const countOff = samplePoisson(rng, rate * p.sumOff);
        const countOn = samplePoisson(rng, rate * p.sumOn);
        for (let i = 0; i < countOff; i += 1) catTotal += sampleLognormal(rng, muOff, sigma);
        for (let i = 0; i < countOn; i += 1) catTotal += sampleLognormal(rng, muOn, sigma);
      }
      variableTotal += catTotal;
      // まだ記録されていない、今日までの支出。グラフでは明日の分に足す。
      let missing = 0;
      if (p.unrecorded > 0) {
        const offCount = samplePoisson(rng, rate * p.unrecordedOff);
        const onCount = samplePoisson(rng, rate * (p.unrecorded - p.unrecordedOff));
        for (let i = 0; i < offCount; i += 1) missing += sampleLognormal(rng, muOff, sigma);
        for (let i = 0; i < onCount; i += 1) missing += sampleLognormal(rng, muOn, sigma);
        if (D > 0) dayTotals[0]! += missing * scale;
        unrecordedTotal += missing;
      }
      categorySamples[c]![t] = (catTotal + missing) * scale;
    }
    for (let c = nFit; c < nAll; c += 1) categorySamples[c]![t] = 0;

    // 規則的な来店と月払いの請求:その日に来るかどうかと金額を引く。
    let visitTotal = 0;
    for (const { e, day, index, scaled } of probableEvents) {
      if (rng() >= e.probability) continue;
      const amount = e.fixedYen ?? sampleLognormal(rng, e.logMu, e.logSigma);
      const yen = scaled ? amount * scale : amount;
      dayTotals[day]! += yen;
      categorySamples[index]![t]! += yen;
      if (scaled) visitTotal += amount;
      else billTotal += amount;
    }

    for (const { m, expected, index } of unrecordedVisits) {
      const count = samplePoisson(rng, expected);
      for (let i = 0; i < count; i += 1) {
        const amount = sampleLognormal(rng, m.logMu, m.logSigma);
        if (D > 0) dayTotals[0]! += amount * scale;
        categorySamples[index]![t]! += amount * scale;
        unrecordedTotal += amount;
      }
    }

    // 特別費:回数をポアソンで引き、金額は過去の特別費から選び、日付は残りの日から選ぶ。
    let specialTotal = 0;
    if (input.specialHistoricalAmounts.length > 0 && D > 0) {
      const count = samplePoisson(rng, input.specialOccurrencesPerDay * D);
      for (let i = 0; i < count; i += 1) {
        const yen = pickOne(rng, input.specialHistoricalAmounts);
        specialTotal += yen;
        dayTotals[Math.min(D - 1, Math.floor(rng() * D))]! += yen * scale;
      }
    }

    const remaining = (variableTotal + visitTotal + specialTotal + unrecordedTotal) * scale;
    totalSamples[t] = input.actualYen + eventsYen + billTotal + remaining;
    specialSamples[t] = specialTotal * scale;
    variableSamples[t] = (variableTotal + visitTotal) * scale;
    unrecordedSamples[t] = unrecordedTotal * scale;
    if (pathIncrements !== null) {
      let running = 0;
      for (let d = 0; d < D; d += 1) {
        running += dayTotals[d]!;
        pathIncrements[t * D + d] = running;
      }
    }
  }

  return {
    trials,
    futureDates,
    categories,
    totalSamples,
    pathIncrements,
    specialSamples,
    variableSamples,
    categorySamples,
    unrecordedSamples,
    eventsYen,
  };
}

function sortedCopy(samples: Float64Array): Float64Array {
  return Float64Array.from(samples).sort();
}

function mean(samples: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]!;
  return samples.length > 0 ? sum / samples.length : 0;
}

/** 金額は整数の円で返す(画面の formatYen は整数でないと例外にする、ADR-008)。 */
function bandAt(sorted: Float64Array, levels: Levels, shift = 0): Band {
  const p10 = Math.max(0, Math.round(quantileAt(sorted, levels.p10) + shift));
  const p50 = Math.max(p10, Math.round(quantileAt(sorted, levels.p50) + shift));
  const p70 = Math.max(p50, Math.round(quantileAt(sorted, levels.p70) + shift));
  const p90 = Math.max(p70, Math.round(quantileAt(sorted, levels.p90) + shift));
  return { p10, p50, p70, p90 };
}

type Levels = { p10: number; p50: number; p70: number; p90: number };

/** 期間全体の、いつもの使い方での変動費の累計の割合と、決まっている支払いの累計(理想の線の形)。 */
function typicalProfile(input: SimulateInput): TypicalProfilePoint[] {
  const dates = eachDay(input.periodFrom, input.periodTo);
  const committedByDate = new Map<DateOnly, number>();
  for (const e of input.events ?? []) {
    committedByDate.set(e.date, (committedByDate.get(e.date) ?? 0) + e.amountYen);
  }
  for (const b of input.billEvents ?? []) {
    const yen = b.probability * (b.fixedYen ?? Math.exp(b.logMu + b.logSigma ** 2 / 2));
    committedByDate.set(b.date, (committedByDate.get(b.date) ?? 0) + yen);
  }
  const daily = dates.map((date) => {
    let yen = 0;
    for (const cat of input.fitted.categories) {
      const rate = cat.countPosterior.alpha / cat.countPosterior.beta;
      const off = dayFeature(date, input.payday).dayOff;
      const { delta, share } = cat.dayOffAmount;
      const mu = cat.amountPosterior.mu + (off ? (1 - share) * delta : -share * delta);
      yen +=
        rate *
        rateFactor(cat, date, input.payday, input.fitted.monthFactor) *
        Math.exp(mu + cat.amountPosterior.sigmaSq / 2);
    }
    return yen;
  });
  const totalDaily = daily.reduce((a, b) => a + b, 0);
  let cumShare = 0;
  let committed = 0;
  return dates.map((date, i) => {
    cumShare += totalDaily > 0 ? daily[i]! / totalDaily : 1 / dates.length;
    committed += committedByDate.get(date) ?? 0;
    return { date, committedYen: Math.round(committed), share: Math.min(1, cumShare) };
  });
}

export function simulateForecast(input: SimulateInput): Forecast {
  const run = runTrials({ ...input, mode: input.mode ?? 'paths' });
  const { trials, categories, totalSamples, specialSamples, variableSamples, categorySamples } =
    run;
  const nAll = categories.length;
  const cal = input.calibration ?? null;
  const levels: Levels = {
    p10: rawLevelFor(cal, 0.1),
    p50: rawLevelFor(cal, 0.5),
    p70: rawLevelFor(cal, 0.7),
    p90: rawLevelFor(cal, 0.9),
  };

  const sortedTotal = sortedCopy(totalSamples);
  const total = bandAt(sortedTotal, levels);
  const categoryMedian = categorySamples.map((s) => quantileAt(sortedCopy(s), 0.5));

  // 予算を超えた試行での、各カテゴリの「ふだんより多い分」(原因の割り当て)。
  const overshootByCategory = new Float64Array(nAll);
  let overshootTrialCount = 0;
  let overshootSum = 0;
  if (input.budgetYen !== null) {
    for (let t = 0; t < trials; t += 1) {
      if (totalSamples[t]! <= input.budgetYen) continue;
      overshootTrialCount += 1;
      overshootSum += totalSamples[t]! - input.budgetYen;
      for (let c = 0; c < nAll; c += 1) {
        overshootByCategory[c]! += Math.max(0, categorySamples[c]![t]! - categoryMedian[c]!);
      }
    }
  }

  const baseDetail = new Map<string, { actual: number; scheduled: number; fixed: number }>();
  for (const b of input.baseByCategory ?? []) {
    const d = baseDetail.get(b.categoryId) ?? { actual: 0, scheduled: 0, fixed: 0 };
    d.actual += b.actualYen;
    d.scheduled += b.scheduledYen;
    d.fixed += b.fixedYen;
    baseDetail.set(b.categoryId, d);
  }
  const plain: Levels = { p10: 0.1, p50: 0.5, p70: 0.7, p90: 0.9 };
  const byCategory: ForecastCategoryBand[] = categories.map((cat, c) => {
    const detail = baseDetail.get(cat.id) ?? { actual: 0, scheduled: 0, fixed: 0 };
    const variableSorted = sortedCopy(categorySamples[c]!);
    let over = 0;
    if (cat.target !== null) {
      for (let t = 0; t < trials; t += 1)
        if (cat.base + categorySamples[c]![t]! > cat.target) over += 1;
    }
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      p10: Math.round(quantileAt(variableSorted, 0.1)),
      p50: Math.round(quantileAt(variableSorted, 0.5)),
      p90: Math.round(quantileAt(variableSorted, 0.9)),
      landing: bandAt(variableSorted, plain, cat.base),
      baseYen: cat.base,
      actualYen: detail.actual,
      scheduledYen: detail.scheduled,
      fixedYen: detail.fixed,
      targetYen: cat.target,
      exceedance: cat.target === null ? null : over / trials,
    };
  });

  const probWithinBudget =
    input.budgetYen !== null ? calibratedProbability(cal, 1 - overshootTrialCount / trials) : null;

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

  const D = run.futureDates.length;
  const safeDailyAllowance =
    input.budgetYen !== null && D > 0
      ? findSafeDailyAllowance({
          budgetYen: input.budgetYen,
          fixedPart: (i: number) => totalSamples[i]! - variableSamples[i]!,
          variableSamples,
          remainingDays: D,
          targetRawProb: rawLevelFor(cal, SAFE_ALLOWANCE_TARGET_PROB),
        })
      : null;

  // グラフの線と帯:日ごとの累計の増分の分位(着地と同じ分位の位置)。最終日 + 実績 = 着地。
  const path: PathPoint[] = [];
  if (run.pathIncrements !== null) {
    const column = new Float64Array(trials);
    for (let d = 0; d < D; d += 1) {
      for (let t = 0; t < trials; t += 1) column[t] = run.pathIncrements[t * D + d]!;
      column.sort();
      const band = bandAt(column, levels);
      path.push({ date: run.futureDates[d]!, p10: band.p10, p50: band.p50, p90: band.p90 });
    }
    // 最終日は着地と同じ数字にそろえる(丸めの差も残さない)。
    const last = path[path.length - 1];
    if (last) {
      last.p10 = Math.max(0, total.p10 - input.actualYen);
      last.p50 = Math.max(0, total.p50 - input.actualYen);
      last.p90 = Math.max(0, total.p90 - input.actualYen);
    }
  }

  const visitExpected = (input.visits ?? []).reduce(
    (sum, v) => sum + v.probability * Math.exp(v.logMu + v.logSigma ** 2 / 2),
    0,
  );
  const billExpected = (input.billEvents ?? []).reduce(
    (sum, b) => sum + b.probability * (b.fixedYen ?? Math.exp(b.logMu + b.logSigma ** 2 / 2)),
    0,
  );
  const sortedSpecial = sortedCopy(specialSamples);

  return {
    periodId: input.periodId,
    asOf: input.today,
    remainingDays: input.remainingDays,
    total: { ...total, mean: Math.round(mean(totalSamples)) },
    path,
    typicalProfile: typicalProfile(input),
    byCategory,
    committed: { scheduledYen: 0, fixedYen: 0 }, // engine.ts が上書きする
    actualYen: input.actualYen,
    visits: {
      expectedYen: Math.round(visitExpected),
      merchants: (input.regularMerchants ?? []).map((m) => ({
        label: m.label,
        everyDays: m.everyDays,
        probability: m.probability,
        meanYen: Math.round(m.meanYen),
      })),
    },
    bills: {
      expectedYen: Math.round(billExpected),
      items: (input.bills ?? []).map((b) => ({ label: b.label, meanYen: Math.round(b.meanYen) })),
    },
    unrecordedYen: Math.round(mean(run.unrecordedSamples)),
    pace: { remainingYen: 0, perDayYen: null, recentPerDayYen: null }, // engine.ts が埋める
    seasonal: { active: input.fitted.seasonal, periodFactor: null }, // engine.ts が埋める
    special: {
      expected: Math.round(mean(specialSamples)),
      p90: Math.round(quantileAt(sortedSpecial, 0.9)),
    },
    probWithinBudget,
    expectedOvershoot: overshootTrialCount > 0 ? Math.round(overshootSum / overshootTrialCount) : 0,
    drivers,
    safeDailyAllowance,
    status: input.fitted.dataDays < LEARNING_DATA_DAYS ? 'learning' : 'ready',
    dataDays: input.fitted.dataDays,
    phase: 'early', // engine.ts が埋める
    calibration: null, // engine.ts が埋める
    provisional: true, // engine.ts が埋める
    balance: null, // engine.ts が埋める
  };
}

/** 検証用:合計額の生のサンプルだけを返す(速い 'totals' で回す)。 */
export function simulateTotalSamples(input: SimulateInput): Float64Array {
  return runTrials({ ...input, mode: 'totals' }).totalSamples;
}

/**
 * 変動費全体に係数kを掛けたとき、予算内に収まる確率がちょうど80%(補正後)になるkを
 * 二分探索で求める。(k × 変動費の1日あたりの期待値)を安全に使える額とする。
 */
function findSafeDailyAllowance(input: {
  budgetYen: number;
  fixedPart: (trialIndex: number) => number;
  variableSamples: Float64Array;
  remainingDays: number;
  targetRawProb: number;
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
  if (probAt(0) < input.targetRawProb) return 0;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (probAt(mid) >= input.targetRawProb) lo = mid;
    else hi = mid;
  }
  const meanVariable = mean(input.variableSamples);
  const dailyVariableMean = meanVariable / Math.max(1, input.remainingDays);
  return Math.max(0, Math.round(lo * dailyVariableMean));
}
