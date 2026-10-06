/**
 * 検証と補正。過去に終わった期間について、期間内の2日おきの時点から予測を作り直し、実際の着地と
 * 比べる。その時点で知り得た明細だけを使う(記録した日 created_at で切る。あとから入れた明細を
 * 混ぜると、検証が実際より当たって見える)。
 *
 * 求めるもの:
 *   - 半減期 × 今月の水準の強さ k の組み合わせ(確率予測の誤差 CRPS が最小のもの)
 *   - 時点帯(序盤・中盤・終盤)ごとの中心の補正係数
 *   - PIT(実際の着地が予測分布の何パーセント点に入ったか)の分布 → 確率と分位の補正
 *
 * 固定費の検出(confirmedFixedKeys)は過去の時点の状態を再現できないので、検証では使わない
 * (日付の決まった額なので、変動する部分の当たり外れには影響しない)。
 */

import { addDays, type DateOnly } from '@/lib/date';
import { periodDays } from '@/domain/period';
import type { ForecastSourceTransaction } from './decompose';
import { phaseOf } from './engine';
import { cautionsFor, type CautionPrecision } from './caution';
import { knownAt } from './lag';
import { DEFAULT_MONTH_LEVEL_K } from './model';
import { decomposeFor, fitFor, simulateInputFor } from './pipeline';
import { runTrials } from './simulate';
import type { DecomposedSpending, ForecastCalibration, ForecastPhase } from './types';

export type BacktestPoint = {
  periodFrom: DateOnly;
  periodTo: DateOnly;
  asOf: DateOnly;
  phase: ForecastPhase;
  actualTotal: number;
  /** その時点ですでに決まっている額(実績 + 予定 + 固定費)。残りの予測の誤差を測る起点。 */
  knownYen: number;
  /** 着地の試行(昇順)。 */
  samples: Float64Array;
  p10: number;
  p50: number;
  p90: number;
  hitWithin80: boolean;
  crps: number;
  /** 目標があるとき:この時点で出した注意(このままだと超える)の数と、実際に超えた数。 */
  cautions: { issued: number; hits: number };
};

export type BacktestSummary = {
  points: readonly BacktestPoint[];
  hitRate80: number;
  medianAbsErrorRatio: number;
  /** 符号つきの誤差 (中央値 − 実際) ÷ 実際 の平均。負なら低く出ている。 */
  medianBias: number;
  meanCrps: number;
  /** 時点帯ごとの、注意の精度(設計書 v3 3.2)。 */
  cautionPrecision: CautionPrecision;
};

/**
 * ジャンルごとの実際の支出(期間全体。返金を差し引く)。目標と同じく特別費は数えない
 * (目標の対象は特別費を除いた支出。ジャンル別の着地も特別費を含まない)。
 */
export function actualByCategoryForPeriod(
  transactions: readonly ForecastSourceTransaction[],
  period: { from: DateOnly; to: DateOnly },
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transactions) {
    if (t.isTransfer || t.reviewStatus === 'ignored') continue;
    if (t.occurredOn < period.from || t.occurredOn > period.to) continue;
    if (t.kind === 'special') continue;
    const id = t.genreId ?? 'none';
    if (t.amountYen < 0) out.set(id, (out.get(id) ?? 0) - t.amountYen);
    else if (t.kind === 'refund') out.set(id, (out.get(id) ?? 0) - t.amountYen);
  }
  return out;
}

/** 実際の着地(期間全体の支出。特別費を含み、返金を差し引く)。検証の正解に使う。 */
export function actualTotalForPeriod(
  transactions: readonly ForecastSourceTransaction[],
  period: { from: DateOnly; to: DateOnly },
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.isTransfer || t.reviewStatus === 'ignored') continue;
    if (t.occurredOn < period.from || t.occurredOn > period.to) continue;
    if (t.amountYen < 0) total += -t.amountYen;
    else if (t.kind === 'refund') total -= t.amountYen;
  }
  return total;
}

/** asOf 時点で知り得た明細(状態は asOf から見た実績・予定に直す)。 */
export function knownTransactionsAt(
  transactions: readonly ForecastSourceTransaction[],
  asOf: DateOnly,
): ForecastSourceTransaction[] {
  const out: ForecastSourceTransaction[] = [];
  for (const t of transactions) {
    if (!knownAt(t, asOf)) continue;
    const status = t.occurredOn > asOf ? 'scheduled' : 'actual';
    out.push(status === t.status ? t : { ...t, status });
  }
  return out;
}

/** 期間の中の検証の時点(2日おき。最終日は含めない)。 */
export function checkpointsFor(
  period: { from: DateOnly; to: DateOnly },
  stepDays = 2,
): { asOf: DateOnly; phase: ForecastPhase }[] {
  const days = periodDays(period.from, period.to);
  const out: { asOf: DateOnly; phase: ForecastPhase }[] = [];
  for (let elapsed = stepDays; elapsed <= days - 1; elapsed += stepDays) {
    const asOf = addDays(period.from, elapsed - 1);
    out.push({ asOf, phase: phaseOf(period, asOf) });
  }
  return out;
}

/** 試行(昇順)と実際の値の CRPS(確率予測の誤差。小さいほど良い)。O(n)。 */
export function crpsSorted(sorted: Float64Array, actual: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  let term1 = 0;
  let term2 = 0;
  for (let i = 0; i < n; i += 1) {
    term1 += Math.abs(sorted[i]! - actual);
    term2 += (2 * i - n + 1) * sorted[i]!;
  }
  return term1 / n - term2 / (n * n);
}

/** 経験的CRPS(並べ替えてから crpsSorted)。 */
export function empiricalCrps(samples: Float64Array, actual: number): number {
  return crpsSorted(Float64Array.from(samples).sort(), actual);
}

function quantile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

export type BacktestInput = {
  transactions: readonly ForecastSourceTransaction[];
  /** 検証する、既に終わった期間。 */
  periods: readonly { from: DateOnly; to: DateOnly }[];
  trainingWindowDays: number;
  recordStart: DateOnly | null;
  payday?: number | null;
  /** 「予測を止める」にしたジャンル(本番と同じ扱いで検証する)。 */
  noForecastGenreIds?: ReadonlySet<string>;
  trials?: number;
  /** 時点の間隔(日)。 */
  stepDays?: number;
  /**
   * 注意の精度を測るときの、ジャンルごとの目標(30日あたり)。検証する月の日数に合わせて伸ばす。
   * 本番では今の目標を、過去の月にもあったものとして当てる。
   */
  cautionTargets?: readonly { categoryId: string; targetYen: number }[];
};

type Checkpoint = {
  period: { from: DateOnly; to: DateOnly };
  asOf: DateOnly;
  phase: ForecastPhase;
  actualTotal: number;
  actualByCategory: ReadonlyMap<string, number>;
  /** 期間の記録を分けたとき(k が有限)と、分けないとき(k=∞)の分解。 */
  decomposed: (separate: boolean) => DecomposedSpending;
};

function checkpointsOf(input: BacktestInput): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (const period of input.periods) {
    if (periodDays(period.from, period.to) < 5) continue;
    const actualTotal = actualTotalForPeriod(input.transactions, period);
    const actualByCategory = input.cautionTargets
      ? actualByCategoryForPeriod(input.transactions, period)
      : new Map<string, number>();
    for (const { asOf, phase } of checkpointsFor(period, input.stepDays ?? 2)) {
      const known = knownTransactionsAt(input.transactions, asOf);
      const cache = new Map<boolean, DecomposedSpending>();
      out.push({
        period,
        asOf,
        phase,
        actualTotal,
        actualByCategory,
        decomposed: (separate) => {
          const hit = cache.get(separate);
          if (hit) return hit;
          const value = decomposeFor({
            transactions: known,
            period,
            today: asOf,
            trainingFrom: addDays(asOf, -input.trainingWindowDays),
            recordStart: input.recordStart,
            confirmedFixedKeys: new Set(),
            detectedSubscriptions: [],
            noForecastGenreIds: input.noForecastGenreIds,
            monthLevelK: separate ? DEFAULT_MONTH_LEVEL_K : Infinity,
          });
          cache.set(separate, value);
          return value;
        },
      });
    }
  }
  return out;
}

function pointFor(
  cp: Checkpoint,
  input: BacktestInput,
  halfLifeDays: number | undefined,
  monthLevelK: number,
  fitted?: ReturnType<typeof fitFor>,
): BacktestPoint {
  const decomposed = cp.decomposed(Number.isFinite(monthLevelK));
  const model = fitted ?? fitFor(decomposed, input.payday ?? null, halfLifeDays);
  const simulateInput = simulateInputFor(decomposed, model, {
    budgetYen: null,
    payday: input.payday ?? null,
    trials: input.trials ?? 600,
    seed: `backtest:${cp.period.from}:${cp.asOf}`,
    monthLevelK,
    mode: 'totals',
  });
  const run = runTrials(simulateInput);
  const samples = run.totalSamples.sort();
  const p10 = quantile(samples, 0.1);
  const p50 = quantile(samples, 0.5);
  const p90 = quantile(samples, 0.9);
  return {
    periodFrom: cp.period.from,
    periodTo: cp.period.to,
    asOf: cp.asOf,
    phase: cp.phase,
    actualTotal: cp.actualTotal,
    knownYen: decomposed.actualYen + run.eventsYen,
    samples,
    p10,
    p50,
    p90,
    hitWithin80: cp.actualTotal >= p10 && cp.actualTotal <= p90,
    crps: crpsSorted(samples, cp.actualTotal),
    cautions: cautionHits(cp, input, run, decomposed),
  };
}

/** この時点で、本番と同じ規則で出す注意と、それが当たったか(月末に実際に目標を超えたか)。 */
function cautionHits(
  cp: Checkpoint,
  input: BacktestInput,
  run: ReturnType<typeof runTrials>,
  decomposed: DecomposedSpending,
): { issued: number; hits: number } {
  if (!input.cautionTargets || input.cautionTargets.length === 0) return { issued: 0, hits: 0 };
  const scale = periodDays(cp.period.from, cp.period.to) / 30;
  const rows = input.cautionTargets.map((t) => {
    const index = run.categories.findIndex((c) => c.id === t.categoryId);
    const base = index >= 0 ? run.categories[index]!.base : 0;
    const target = Math.round(t.targetYen * scale);
    const remaining = index >= 0 ? Float64Array.from(run.categorySamples[index]!).sort() : null;
    let over = 0;
    if (remaining) for (const v of remaining) if (base + v > target) over += 1;
    return {
      categoryId: t.categoryId,
      type: decomposed.categoryTypes[t.categoryId] ?? 'steady',
      targetYen: target,
      medianYen: base + (remaining ? quantile(remaining, 0.5) : 0),
      baseYen: base,
      exceedance:
        remaining && remaining.length > 0 ? over / remaining.length : base > target ? 1 : 0,
    };
  });
  const likely = cautionsFor(rows).filter((c) => c.kind === 'likely');
  const targetById = new Map(rows.map((r) => [r.categoryId, r.targetYen]));
  let hits = 0;
  for (const c of likely) {
    if ((cp.actualByCategory.get(c.categoryId) ?? 0) > (targetById.get(c.categoryId) ?? Infinity)) {
      hits += 1;
    }
  }
  return { issued: likely.length, hits };
}

export function summarize(points: readonly BacktestPoint[]): BacktestSummary {
  const n = points.length;
  const cautionPrecision: CautionPrecision = {};
  for (const p of points) {
    if (p.cautions.issued === 0) continue;
    const acc = cautionPrecision[p.phase] ?? { issued: 0, hits: 0 };
    acc.issued += p.cautions.issued;
    acc.hits += p.cautions.hits;
    cautionPrecision[p.phase] = acc;
  }
  if (n === 0) {
    return {
      points,
      hitRate80: 0,
      medianAbsErrorRatio: 0,
      medianBias: 0,
      meanCrps: 0,
      cautionPrecision,
    };
  }
  let hits = 0;
  let absErr = 0;
  let bias = 0;
  let crps = 0;
  for (const p of points) {
    if (p.hitWithin80) hits += 1;
    const denom = Math.max(1, p.actualTotal);
    absErr += Math.abs(p.p50 - p.actualTotal) / denom;
    bias += (p.p50 - p.actualTotal) / denom;
    crps += p.crps;
  }
  return {
    points,
    hitRate80: hits / n,
    medianAbsErrorRatio: absErr / n,
    medianBias: bias / n,
    meanCrps: crps / n,
    cautionPrecision,
  };
}

export function runBacktest(
  input: BacktestInput & { halfLifeDays?: number; monthLevelK?: number },
): BacktestSummary {
  const k = input.monthLevelK ?? DEFAULT_MONTH_LEVEL_K;
  return summarize(checkpointsOf(input).map((cp) => pointFor(cp, input, input.halfLifeDays, k)));
}

export type GridScore = { halfLifeDays: number; monthLevelK: number; meanCrps: number };

/**
 * 半減期 × k の組み合わせを、同じ時点で比べる。分解は時点ごとに1回、モデル推定は時点 × 半減期
 * ごとに1回だけ行い、k ごとにシミュレーションだけ回す(k は推定に影響しない)。
 */
export function backtestGrid(
  input: BacktestInput & {
    halfLives: readonly number[];
    monthLevelKs: readonly number[];
  },
): GridScore[] {
  const checkpoints = checkpointsOf(input);
  const sums = new Map<string, { halfLifeDays: number; monthLevelK: number; sum: number }>();
  for (const cp of checkpoints) {
    for (const separate of [true, false]) {
      const ks = input.monthLevelKs.filter((k) => Number.isFinite(k) === separate);
      if (ks.length === 0) continue;
      const decomposed = cp.decomposed(separate);
      for (const halfLifeDays of input.halfLives) {
        const fitted = fitFor(decomposed, input.payday ?? null, halfLifeDays);
        for (const k of ks) {
          const point = pointFor(cp, input, halfLifeDays, k, fitted);
          const key = `${halfLifeDays}:${k}`;
          const acc = sums.get(key) ?? { halfLifeDays, monthLevelK: k, sum: 0 };
          acc.sum += point.crps;
          sums.set(key, acc);
        }
      }
    }
  }
  return [...sums.values()].map((s) => ({
    halfLifeDays: s.halfLifeDays,
    monthLevelK: s.monthLevelK,
    meanCrps: checkpoints.length > 0 ? s.sum / checkpoints.length : 0,
  }));
}

const MIN_CENTER_FACTOR = 0.75;
const MAX_CENTER_FACTOR = 1.4;
/** 中心の補正は、検証の月数が少ないほど1に寄せる(この月数ぶんの事前の確信)。 */
const CENTER_PRIOR_MONTHS = 8;
/** PIT の補正は、検証の月数が少ないほど弱める(a = 月数 ÷ (月数 + 6))。 */
const PIT_PRIOR_MONTHS = 6;
/** 時点帯ごとの PIT を使うのに要る、その帯の時点の数。少なければ全体の PIT を使う。 */
const MIN_PIT_POINTS_PER_PHASE = 10;
/** 補正を出すのに要る、検証の時点の最小数。 */
export const MIN_BACKTEST_POINTS_FOR_CALIBRATION = 6;

/** 残りの部分だけを係数で動かす(決まっている額 known はそのまま)。 */
export function shiftRemaining(value: number, known: number, factor: number): number {
  return known + (value - known) * factor;
}

/** 時点帯の中心の補正:Σ(実際 − 決まっている額) ÷ Σ(予測の中央値 − 決まっている額) を1へ寄せる。 */
function centerFactorOf(points: readonly BacktestPoint[], months: number): number {
  let actualSum = 0;
  let predictedSum = 0;
  for (const p of points) {
    const predicted = p.p50 - p.knownYen;
    if (predicted <= 0) continue;
    actualSum += Math.max(0, p.actualTotal - p.knownYen);
    predictedSum += predicted;
  }
  if (predictedSum <= 0) return 1;
  const raw = actualSum / predictedSum;
  const weight = months / (months + CENTER_PRIOR_MONTHS);
  return Math.min(MAX_CENTER_FACTOR, Math.max(MIN_CENTER_FACTOR, 1 + weight * (raw - 1)));
}

/** 試行(昇順)の中で、実際の値が何パーセント点か(同じ値は半分ずつ数える)。 */
function pitOf(sorted: Float64Array, known: number, factor: number, actual: number): number {
  const n = sorted.length;
  if (n === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (let i = 0; i < n; i += 1) {
    const x = shiftRemaining(sorted[i]!, known, factor);
    if (x < actual) below += 1;
    else if (x === actual) equal += 1;
  }
  return (below + equal / 2) / n;
}

/** 検証の結果から、時点帯ごとの中心の補正と、確率の補正(PIT)を求める。 */
export function calibrateFromBacktest(
  points: readonly BacktestPoint[],
  months: number,
): ForecastCalibration | null {
  if (points.length < MIN_BACKTEST_POINTS_FOR_CALIBRATION || months <= 0) return null;
  const phases: ForecastPhase[] = ['early', 'mid', 'late'];
  const all = centerFactorOf(points, months);
  const centerByPhase = Object.fromEntries(
    phases.map((phase) => {
      const own = points.filter((p) => p.phase === phase);
      return [phase, own.length >= 3 ? centerFactorOf(own, months) : all];
    }),
  ) as ForecastCalibration['centerByPhase'];
  const pits = points.map((p) => ({
    phase: p.phase,
    u: pitOf(p.samples, p.knownYen, centerByPhase[p.phase], p.actualTotal),
  }));
  const pit = pits.map((p) => p.u).sort((a, b) => a - b);
  const pitByPhase = Object.fromEntries(
    phases.map((phase) => {
      const own = pits.filter((p) => p.phase === phase).map((p) => p.u);
      return [phase, own.length >= MIN_PIT_POINTS_PER_PHASE ? own.sort((a, b) => a - b) : pit];
    }),
  ) as unknown as ForecastCalibration['pitByPhase'];
  return {
    centerByPhase,
    pit,
    pitByPhase,
    pitWeight: months / (months + PIT_PRIOR_MONTHS),
    months,
    sampleSize: points.length,
  };
}
