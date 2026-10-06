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
  SpendingType,
  LumpyCategory,
  TypicalProfilePoint,
  ForecastBreakdown,
  ForecastSuggestion,
  ForecastWhatIf,
} from './types';

export const DEFAULT_TRIALS = 10_000;
export const MIN_TRIALS = 2_000;
/** 変動費の記録がこの日数未満なら「学習中」。 */
export const LEARNING_DATA_DAYS = 14;
/** 安全に使える1日の額が守るべき、予算内に収まる確率の目標。 */
const SAFE_ALLOWANCE_TARGET_PROB = 0.8;
/** totalQuantiles の分位(5%〜95%、5% きざみ)。 */
export const TOTAL_QUANTILE_LEVELS: readonly number[] = Array.from(
  { length: 19 },
  (_, i) => (i + 1) / 20,
);

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
  /**
   * ジャンルごとの今月の水準 M_g の強さ k_g(設計書 v3 4.2)。λ_g = λ'_g · L · M_g、
   * M_g | L ~ Gamma(k_g + n_g, k_g + L λ'_g S_g)。Infinity(既定)なら M_g = 1(全体の水準だけ)。
   */
  genreLevelK?: number;
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
  /** カテゴリごとの支出の型(設計書 v3 4.1)。無いカテゴリは定常型。 */
  categoryTypes?: Readonly<Record<string, SpendingType>>;
  /** まとまり型のジャンル(出来事の回数 × 大きさで予測する)。 */
  lumpy?: readonly LumpyCategory[];
  /** 「これ以上は使わない」にしたジャンルの守られ方(いつもの見込みに掛ける。設計書 v3 4.7)。 */
  keepRates?: Readonly<Record<string, number>>;
  /**
   * 今日のうち、もう過ぎた割合(いつもの1日の使い方で、今の時刻までに使う割合。設計書 v3 4.9)。
   * 1(既定)なら今日は終わったものとして扱う。1未満なら、今日の残りの見込みを足す。
   */
  todayElapsedShare?: number;
  /**
   * 本人が決めた約束(「外食を週1回へらす」)。今日の月の終わりまで、そのカテゴリの回数を
   * 週に perWeek 回へらしたとして見込む(ジャンル画面の「決める」、ADR-075)。
   */
  promises?: readonly ForecastPromise[];
};

/**
 * まとまり型の出来事の率の事前分布:Gamma(1, 90日)(90日に1回ほど。まとまり型は月2回未満なので、
 * 記録の短い人の「60日に1回の旅行」を「2か月ごとに旅行」と読みすぎない)。出来事の間隔はワイブル分布(形 β、
 * 平均 = 1 ÷ 率)とみなし、前回からの日数 s から s+1 日の間に起きる確率を
 * 1 − exp((s/λ)^β − ((s+1)/λ)^β)、λ = 平均間隔 ÷ Γ(1 + 1/β) にする。β=1 なら日数によらず、
 * β が大きいほど前回の直後は起きにくい。
 */
const LUMPY_PRIOR = { events: 1, days: 90 } as const;
/** 残りの期間に予定があるとき、別の出来事の起きやすさに掛ける倍率(予定が主役)。 */
const LUMPY_SCHEDULED_FACTOR = 0.2;
/** 出来事の金額の、記録が少ないときの対数のばらつき。 */
const LUMPY_FALLBACK_SIGMA = 0.6;
const LUMPY_MIN_SIGMA = 0.25;

export type ForecastPromise = { categoryId: string; perWeek: number };

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
  /** 学習できたカテゴリの、残りの回数の平均と、変動費だけの額の平均(来店・未記録を除く)。 */
  categoryCountMean: Float64Array;
  categoryVariableMean: Float64Array;
  visitMean: number;
  billMean: number;
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
  for (const l of input.lumpy ?? []) touch(l.categoryId, l.categoryName);

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
  const kg = input.genreLevelK ?? Infinity;
  const keep = input.keepRates ?? {};
  const todayDone = Math.min(1, Math.max(0, input.todayElapsedShare ?? 1));
  const todayOff = dayFeature(input.today, input.payday).dayOff;
  const genreLevel = levelUpdate && Number.isFinite(kg) && kg > 0;
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
    let todayRest = 0;
    for (const date of elapsed) {
      // 今日は、もう過ぎた割合の分だけ「使った(記録済み・未記録)」とみなし、残りは今日のこれから。
      const done = date === input.today ? todayDone : 1;
      const f = rateFactor(cat, date, input.payday, input.fitted.monthFactor);
      const share = recordedShare(lag, daysBetween(date, input.today));
      exposure += f * share * done;
      unrecorded += f * (1 - share) * done;
      if (dayFeature(date, input.payday).dayOff) unrecordedOff += f * (1 - share) * done;
      if (date === input.today) todayRest = f * (1 - done);
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
      todayRest,
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
  const countSum = new Float64Array(nAll);
  const variableSum = new Float64Array(nAll);
  const lumpy = (input.lumpy ?? [])
    .map((l) => {
      const n = l.eventLogAmounts.length;
      const mu = n > 0 ? l.eventLogAmounts.reduce((a, b) => a + b, 0) / n : 0;
      const sd =
        n >= 3
          ? Math.sqrt(l.eventLogAmounts.reduce((a, v) => a + (v - mu) ** 2, 0) / (n - 1))
          : LUMPY_FALLBACK_SIGMA;
      const sigma = Math.max(LUMPY_MIN_SIGMA, sd);
      return { l, n, mu, sigma, index: indexById.get(l.categoryId) };
    })
    .filter((x): x is typeof x & { index: number } => x.index !== undefined && x.n > 0);
  let visitSum = 0;
  let billSum = 0;
  const categorySamples: Float64Array[] = categories.map(() => new Float64Array(trials));
  const pathIncrements = mode === 'paths' && D > 0 ? new Float64Array(trials * D) : null;
  const dayTotals = new Float64Array(Math.max(1, D));
  const lambdas = new Float64Array(nFit);
  // 外出のジャンルに日ごとに共通して掛かるゆらぎ(設計書 v3 4.2)。
  const shock = input.fitted.outingShock ?? null;
  const outing = new Uint8Array(nFit);
  if (shock) {
    const ids = new Set(shock.categoryIds);
    for (let c = 0; c < nFit; c += 1) if (ids.has(fittedCats[c]!.categoryId)) outing[c] = 1;
  }
  const dayShock = new Float64Array(Math.max(1, D)).fill(1);

  for (let t = 0; t < trials; t += 1) {
    dayTotals.set(eventsByDay);
    let variableTotal = 0;
    let unrecordedTotal = 0;
    let billTotal = 0;

    for (let c = 0; c < nFit; c += 1) {
      const post = fittedCats[c]!.countPosterior;
      lambdas[c] = sampleGamma(rng, post.alpha, 1 / post.beta);
    }
    // 'paths' は日ごとに引く。'totals' は残りの日数で平均したゆらぎ(形 a × 日数)を1つ引く。
    let totalShock = 1;
    if (shock) {
      if (pathIncrements !== null) {
        for (let d = 0; d < D; d += 1) dayShock[d] = sampleGamma(rng, shock.shape, 1 / shock.shape);
      } else if (D > 0) {
        totalShock = sampleGamma(rng, shock.shape * D, 1 / (shock.shape * D));
      }
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
      let rate = lambdas[c]! * level * (keep[cat.categoryId] ?? 1);
      if (genreLevel) {
        const n = obsById.get(cat.categoryId)?.count ?? 0;
        rate *= sampleGamma(rng, kg + n, 1 / (kg + rate * p.exposure));
      }
      const muTrial = p.muMonth + p.muSd * sampleStandardNormal(rng);
      const sigma = p.sigmaWithin;
      // 休みの日(土日祝)と平日で、1回の金額が違う(居酒屋は休みの日に多く、高い)。
      const { delta, share } = cat.dayOffAmount;
      const muOff = muTrial + (1 - share) * delta;
      const muOn = muTrial - share * delta;
      // 1回の金額。店ごとの混合があれば店を選んでから引く(最後の成分は新しい店 = ジャンル全体)。
      const mix = cat.stores;
      const shift = muTrial - cat.amountPosterior.mu;
      const draw = (off: boolean): number => {
        if (!mix) return sampleLognormal(rng, off ? muOff : muOn, sigma);
        const shares = off ? mix.shareOff : mix.shareOn;
        let u = rng();
        let i = 0;
        while (i < shares.length - 1 && u >= shares[i]!) {
          u -= shares[i]!;
          i += 1;
        }
        if (i === shares.length - 1) return sampleLognormal(rng, off ? muOff : muOn, sigma);
        return sampleLognormal(rng, mix.mu[i]! + shift, mix.sigma[i]!);
      };
      let catTotal = 0;
      if (pathIncrements !== null) {
        const shocked = outing[c] === 1;
        for (let d = 0; d < D; d += 1) {
          const count = samplePoisson(rng, rate * p.factors[d]! * (shocked ? dayShock[d]! : 1));
          if (count === 0) continue;
          countSum[c]! += count;
          const off = futureOff[d]!;
          let dayYen = 0;
          for (let i = 0; i < count; i += 1) dayYen += draw(off);
          dayTotals[d]! += dayYen * scale;
          catTotal += dayYen;
        }
      } else {
        const s = outing[c] === 1 ? totalShock : 1;
        const countOff = samplePoisson(rng, rate * p.sumOff * s);
        const countOn = samplePoisson(rng, rate * p.sumOn * s);
        countSum[c]! += countOff + countOn;
        for (let i = 0; i < countOff; i += 1) catTotal += draw(true);
        for (let i = 0; i < countOn; i += 1) catTotal += draw(false);
      }
      variableTotal += catTotal;
      // まだ記録されていない、今日までの支出。グラフでは明日の分に足す。
      let missing = 0;
      if (p.unrecorded > 0) {
        const offCount = samplePoisson(rng, rate * p.unrecordedOff);
        const onCount = samplePoisson(rng, rate * (p.unrecorded - p.unrecordedOff));
        for (let i = 0; i < offCount; i += 1) missing += draw(true);
        for (let i = 0; i < onCount; i += 1) missing += draw(false);
        if (D > 0) dayTotals[0]! += missing * scale;
        unrecordedTotal += missing;
      }
      // 今日のこれから(時刻で縮めた今日の見込み)。グラフでは明日の分に足す。
      if (p.todayRest > 0) {
        const count = samplePoisson(rng, rate * p.todayRest);
        let rest = 0;
        for (let i = 0; i < count; i += 1) rest += draw(todayOff);
        if (D > 0) dayTotals[0]! += rest * scale;
        catTotal += rest;
        variableTotal += rest;
      }
      categorySamples[c]![t] = (catTotal + missing) * scale;
      variableSum[c]! += catTotal * scale;
    }
    for (let c = nFit; c < nAll; c += 1) categorySamples[c]![t] = 0;

    // まとまり型:出来事が起きる日と大きさを引く(前回からの日数で起きやすさが変わる)。
    for (const { l, n, mu, sigma, index } of lumpy) {
      const rate = sampleGamma(
        rng,
        n + LUMPY_PRIOR.events,
        1 / (l.exposureDays + LUMPY_PRIOR.days),
      );
      const beta = l.gapShape;
      const lambda = 1 / Math.max(rate, 1e-6) / gammaFunction(1 + 1 / beta);
      const factor = l.hasScheduled ? LUMPY_SCHEDULED_FACTOR : 1;
      const muTrial = mu + (sigma / Math.sqrt(n)) * sampleStandardNormal(rng);
      let since = l.daysSinceLast;
      let catTotal = 0;
      for (let d = 0; d < D; d += 1) {
        const hazard = (((since + 1) / lambda) ** beta - (since / lambda) ** beta) * factor;
        since += 1;
        if (rng() >= 1 - Math.exp(-hazard)) continue;
        const yen = sampleLognormal(rng, muTrial, sigma);
        catTotal += yen;
        countSum[index]! += 1;
        dayTotals[d]! += yen * scale;
        since = 0;
      }
      categorySamples[index]![t]! += catTotal * scale;
      variableSum[index]! += catTotal * scale;
      variableTotal += catTotal;
    }

    // 規則的な来店と月払いの請求:その日に来るかどうかと金額を引く。
    let visitTotal = 0;
    for (const { e, day, index, scaled } of probableEvents) {
      // 来店は、守られ方を掛けた確率で来る(請求は決まった支払いなので掛けない)。
      if (rng() >= e.probability * (scaled ? (keep[e.categoryId] ?? 1) : 1)) continue;
      const amount = e.fixedYen ?? sampleLognormal(rng, e.logMu, e.logSigma);
      const yen = scaled ? amount * scale : amount;
      dayTotals[day]! += yen;
      categorySamples[index]![t]! += yen;
      if (scaled) visitTotal += amount;
      else billTotal += amount;
      if (scaled) visitSum += yen;
      else billSum += yen;
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
    categoryCountMean: countSum.map((v) => v / trials),
    categoryVariableMean: variableSum.map((v) => v / trials),
    visitMean: visitSum / trials,
    billMean: billSum / trials,
  };
}

/** ガンマ関数 Γ(x)(x > 0、Lanczos 近似)。 */
export function gammaFunction(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFunction(1 - x));
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = c[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (z + i);
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a;
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
  const promised = applyPromises(input, run);
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
      meanYen: Math.round(mean(categorySamples[c]!)),
      expectedCount: c < run.categoryCountMean.length ? run.categoryCountMean[c]! : 0,
      type: input.categoryTypes?.[cat.id] ?? 'steady',
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
  const inner = { p25: rawLevelFor(cal, 0.25), p75: rawLevelFor(cal, 0.75) };
  if (run.pathIncrements !== null) {
    const column = new Float64Array(trials);
    for (let d = 0; d < D; d += 1) {
      for (let t = 0; t < trials; t += 1) column[t] = run.pathIncrements[t * D + d]!;
      column.sort();
      const band = bandAt(column, levels);
      path.push({
        date: run.futureDates[d]!,
        p10: band.p10,
        p25: Math.min(band.p50, Math.max(band.p10, Math.round(quantileAt(column, inner.p25)))),
        p50: band.p50,
        p75: Math.min(band.p90, Math.max(band.p50, Math.round(quantileAt(column, inner.p75)))),
        p90: band.p90,
      });
    }
    // 最終日は着地と同じ数字にそろえる(丸めの差も残さない)。
    const last = path[path.length - 1];
    if (last) {
      last.p10 = Math.max(0, total.p10 - input.actualYen);
      last.p25 = Math.max(
        last.p10,
        Math.round(quantileAt(sortedTotal, inner.p25)) - input.actualYen,
      );
      last.p50 = Math.max(0, total.p50 - input.actualYen);
      last.p75 = Math.max(
        last.p50,
        Math.round(quantileAt(sortedTotal, inner.p75)) - input.actualYen,
      );
      last.p90 = Math.max(0, total.p90 - input.actualYen);
      last.p25 = Math.min(last.p25, last.p50);
      last.p75 = Math.min(last.p75, last.p90);
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
  const suggestion = suggestCut({ input, run, byCategory, cal });
  const whatIf = whatIfOf({ input, run, byCategory, cal, promised });
  const breakdown = breakdownOf({ input, run, total, byCategory });

  return {
    periodId: input.periodId,
    asOf: input.today,
    remainingDays: input.remainingDays,
    total: { ...total, mean: Math.round(mean(totalSamples)) },
    totalQuantiles: TOTAL_QUANTILE_LEVELS.map((p) =>
      Math.round(quantileAt(sortedTotal, rawLevelFor(cal, p))),
    ),
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
    suggestion,
    whatIf,
    breakdown,
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

/**
 * 提案を1つ:定常型のカテゴリの回数を週1回減らしたとき、予算に収まる確率がいちばん上がるもの。
 * 同じ試行のそのカテゴリの額に倍率(1 − 減らす回数 ÷ 見込みの回数)を掛けて数え直す(目安)。
 */
function suggestCut(args: {
  input: SimulateInput;
  run: TrialRun;
  byCategory: readonly ForecastCategoryBand[];
  cal: PitCalibration | null;
}): ForecastSuggestion | null {
  const { input, run, byCategory, cal } = args;
  const budget = input.budgetYen;
  const D = run.futureDates.length;
  if (budget === null || D < 7) return null;
  const weeks = D / 7;
  const within = (shift: (t: number) => number) => {
    let n = 0;
    for (let t = 0; t < run.trials; t += 1) if (run.totalSamples[t]! - shift(t) <= budget) n += 1;
    return calibratedProbability(cal, n / run.trials);
  };
  const probBefore = within(() => 0);
  // 約束したジャンルは、もう決めてあるので重ねて勧めない(ADR-075)。
  const promised = new Set((input.promises ?? []).map((p) => p.categoryId));
  let best: ForecastSuggestion | null = null;
  byCategory.forEach((cat, c) => {
    if (promised.has(cat.categoryId)) return;
    if (cat.type !== 'steady' || cat.expectedCount < weeks * 1.5) return;
    const cut = Math.min(1, weeks / cat.expectedCount);
    const samples = run.categorySamples[c]!;
    const probAfter = within((t) => samples[t]! * cut);
    const savedYen = Math.round(mean(samples) * cut);
    if (savedYen <= 0) return;
    if (best === null || probAfter - probBefore > best.probAfter - best.probBefore) {
      best = {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        perWeek: 1,
        savedYen,
        probBefore,
        probAfter,
      };
    }
  });
  return best;
}

/** 「もし、へらしたら」の選択肢(週に何回へらすか)。 */
const WHAT_IF_PER_WEEK = [0, 1, 2] as const;

/** 今日の月の終わり(約束と「もし」は、その月の終わりまでの回数で数える)。 */
function monthEndOf(date: DateOnly): DateOnly {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

/** 今日の翌日から月末(期間の終わりが先ならそこ)までの日数。 */
function actionDays(input: SimulateInput, run: TrialRun): number {
  const until = monthEndOf(input.today);
  return run.futureDates.filter((d) => d <= until).length;
}

/** 約束を入れる前の、約束したカテゴリの試行の額と回数(「もし」を約束の前から数えるため)。 */
type PromiseState = {
  /** カテゴリの添字 → 約束を入れる前の試行の額。 */
  before: Map<number, Float64Array>;
  /** カテゴリの添字 → 約束で減らした割合。 */
  cut: Map<number, number>;
  /** 約束を入れる前の、カテゴリごとの見込みの回数。 */
  countBefore: Float64Array;
};

/**
 * 約束を試行に入れる:約束したカテゴリの各試行の額に (1 − 週の回数 × 月末までの週数 ÷ 見込みの回数) を
 * 掛け、減らした分を着地・変動費・グラフの累計から引く(グラフは月末までに均等に減らす)。
 * 提案・「もし」と同じ数え方なので、「もし」の選んだ選択肢と、約束を入れた後の数字が一致する。
 */
function applyPromises(input: SimulateInput, run: TrialRun): PromiseState {
  const state: PromiseState = {
    before: new Map(),
    cut: new Map(),
    countBefore: Float64Array.from(run.categoryCountMean),
  };
  const promises = input.promises ?? [];
  if (promises.length === 0) return state;
  const Dm = actionDays(input, run);
  const D = run.futureDates.length;
  if (Dm <= 0) return state;
  const weeks = Dm / 7;
  for (const p of promises) {
    const c = run.categories.findIndex((cat) => cat.id === p.categoryId);
    if (c < 0 || c >= run.categoryCountMean.length) continue;
    const count = run.categoryCountMean[c]!;
    if (count <= 0 || p.perWeek <= 0) continue;
    const cut = Math.min(1, (p.perWeek * weeks) / count);
    const samples = run.categorySamples[c]!;
    state.before.set(c, Float64Array.from(samples));
    state.cut.set(c, cut);
    for (let t = 0; t < run.trials; t += 1) {
      const removed = samples[t]! * cut;
      samples[t] = samples[t]! - removed;
      run.totalSamples[t] = run.totalSamples[t]! - removed;
      run.variableSamples[t] = Math.max(0, run.variableSamples[t]! - removed);
      if (run.pathIncrements !== null) {
        for (let d = 0; d < D; d += 1) {
          run.pathIncrements[t * D + d] =
            run.pathIncrements[t * D + d]! - removed * Math.min(1, (d + 1) / Dm);
        }
      }
    }
    run.categoryCountMean[c] = count * (1 - cut);
    run.categoryVariableMean[c] = run.categoryVariableMean[c]! * (1 - cut);
  }
  return state;
}

/**
 * ジャンル画面の「もし、へらしたら」:提案(suggestCut)と同じ対象・同じ数え方で、
 * いつも通り・週1回・週2回へらしたときのジャンルの着地・目標を超える確率・全体で予算に
 * 収まる確率を出す。回数は今日の月の終わりまでで数える。約束したジャンルは、約束を入れる前の
 * 試行から数えるので、約束した選択肢が byCategory・probWithinBudget と同じ数字になる
 * (約束が無ければ「いつも通り」が同じ数字になる)。
 */
function whatIfOf(args: {
  input: SimulateInput;
  run: TrialRun;
  byCategory: readonly ForecastCategoryBand[];
  cal: PitCalibration | null;
  promised: PromiseState;
}): ForecastWhatIf[] {
  const { input, run, byCategory, cal, promised } = args;
  const budget = input.budgetYen;
  const Dm = actionDays(input, run);
  if (Dm < 7) return [];
  const weeks = Dm / 7;
  const promiseOf = new Map((input.promises ?? []).map((p) => [p.categoryId, p.perWeek]));
  const out: ForecastWhatIf[] = [];
  byCategory.forEach((cat, c) => {
    const expectedCount = c < promised.countBefore.length ? promised.countBefore[c]! : 0;
    if (cat.type !== 'steady' || expectedCount < weeks * 1.5) return;
    const samples = promised.before.get(c) ?? run.categorySamples[c]!;
    // 約束で減らした分を足し戻した着地(他のカテゴリの約束は入ったまま)。
    const promisedCut = promised.cut.get(c) ?? 0;
    const meanYen = mean(samples);
    if (meanYen <= 0) return;
    const scaled = new Float64Array(run.trials);
    const options = WHAT_IF_PER_WEEK.map((perWeek) => {
      const cut = Math.min(1, (perWeek * weeks) / expectedCount);
      let over = 0;
      let within = 0;
      for (let t = 0; t < run.trials; t += 1) {
        const removed = samples[t]! * cut;
        scaled[t] = samples[t]! - removed;
        if (cat.targetYen !== null && cat.baseYen + scaled[t]! > cat.targetYen) over += 1;
        // 約束した選択肢は、約束を入れた後の着地そのもの(足し引きの丸めの差も出さない)。
        const total =
          cut === promisedCut
            ? run.totalSamples[t]!
            : run.totalSamples[t]! + samples[t]! * promisedCut - removed;
        if (budget !== null && total <= budget) within += 1;
      }
      scaled.sort();
      const p10 = Math.max(0, Math.round(cat.baseYen + quantileAt(scaled, 0.1)));
      const p50 = Math.max(p10, Math.round(cat.baseYen + quantileAt(scaled, 0.5)));
      const p90 = Math.max(p50, Math.round(cat.baseYen + quantileAt(scaled, 0.9)));
      return {
        perWeek,
        landing: { p10, p50, p90 },
        exceedance: cat.targetYen === null ? null : over / run.trials,
        probWithinBudget: budget === null ? null : calibratedProbability(cal, within / run.trials),
        savedYen: Math.round(meanYen * cut),
      };
    });
    // 週1回へらすだけで残りが無くなるなら、週2回は出さない(同じ数字が並ぶため)。
    const distinct = options.filter((o, i) => i === 0 || o.savedYen !== options[i - 1]!.savedYen);
    out.push({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      perVisitYen: Math.round(meanYen / expectedCount),
      weeks,
      promisedPerWeek: promiseOf.get(cat.categoryId) ?? null,
      options: distinct,
    });
  });
  return out;
}

/**
 * 着地の積み上げ:使った額 → 決まっている額 → 来店 → 請求 → 未記録 → 特別費 → 残りの変動費。
 * 残り全体(中央値 − 決まっている額)を、各部分の平均の比で配る。合計は total.p50 と同じ。
 */
function breakdownOf(args: {
  input: SimulateInput;
  run: TrialRun;
  total: Band;
  byCategory: readonly ForecastCategoryBand[];
}): ForecastBreakdown {
  const { input, run, total, byCategory } = args;
  const committedYen = Math.round(run.eventsYen);
  const remaining = Math.max(0, total.p50 - input.actualYen - committedYen);
  const parts = {
    visits: run.visitMean,
    bills: run.billMean,
    unrecorded: mean(run.unrecordedSamples),
    special: mean(run.specialSamples),
    variable: run.categoryVariableMean.reduce((a, b) => a + b, 0),
  };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? remaining / sum : 0;
  const visitsYen = Math.round(parts.visits * scale);
  const billsYen = Math.round(parts.bills * scale);
  const unrecordedYen = Math.round(parts.unrecorded * scale);
  const specialYen = Math.round(parts.special * scale);
  // 丸めの差は変動費に寄せ、合計を見出しと必ず一致させる。
  const variableYen = remaining - visitsYen - billsYen - unrecordedYen - specialYen;
  const variableByCategory = byCategory
    .map((cat, c) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      raw: c < run.categoryVariableMean.length ? run.categoryVariableMean[c]! : 0,
    }))
    .filter((x) => x.raw > 0);
  const rawSum = variableByCategory.reduce((a, b) => a + b.raw, 0);
  return {
    actualYen: input.actualYen,
    committedYen,
    visitsYen,
    billsYen,
    unrecordedYen,
    specialYen,
    variableYen,
    totalYen: total.p50,
    variableByCategory: variableByCategory
      .map((x) => ({
        categoryId: x.categoryId,
        categoryName: x.categoryName,
        yen: rawSum > 0 ? Math.round((x.raw / rawSum) * variableYen) : 0,
      }))
      .sort((a, b) => b.yen - a.yen),
  };
}
