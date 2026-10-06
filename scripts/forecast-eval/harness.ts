/**
 * 予測の評価の共通部分(合成データ)。本番と同じ流れで、各月の2日おきの時点から着地を予測し、
 * 実際と比べる:その時点で記録済みの明細だけを使い(記録した日で切る)、完了した月での検証から
 * 補正を求め、予測を出す。v1(以前のエンジン)と v2 を同じ物差しで比べるため、エンジンは
 * 差し替えられるようにしてある(engine 引数)。
 */

import {
  actualByCategoryForPeriod,
  actualTotalForPeriod,
  knownTransactionsAt,
} from '../../src/domain/forecast/backtest';
import type { ForecastSourceTransaction } from '../../src/domain/forecast/decompose';
import { periodDays } from '../../src/domain/period';
import { addDays, addMonths, daysBetween, type DateOnly } from '../../src/lib/date';

/** 時点の間隔(日)。仕様は2日おき。評価を軽くしたいときは環境変数 EVAL_STEP で広げる。 */
const STEP_DAYS = Number(process.env.EVAL_STEP ?? 2);

export type Period = { from: DateOnly; to: DateOnly };
export type Quantiles = { p10: number; p50: number; p90: number };
/** その時点で画面に出す注意(設計書 v3 3.2)。目標は月の目標(円)。 */
export type IssuedCaution = { categoryId: string; targetYen: number };

export type EvalEngine<State> = {
  /** 完了した月(occurredOn < 月初)の明細で検証し、補正などの状態を返す。 */
  verify(input: {
    completed: readonly ForecastSourceTransaction[];
    today: DateOnly;
    payday: number;
  }): State;
  forecast(input: {
    known: readonly ForecastSourceTransaction[];
    period: Period;
    today: DateOnly;
    payday: number;
    state: State;
  }): Quantiles & {
    /** 着地の分位 5%〜95%(19点)。無ければ p10・p50・p90 だけで測る。 */
    quantiles?: readonly number[];
    cautions?: readonly IssuedCaution[];
  };
};

export type Scenario = {
  name: string;
  transactions: readonly ForecastSourceTransaction[];
  months: readonly Period[];
};

export type EvalPoint = Quantiles & {
  scenario: string;
  period: Period;
  asOf: DateOnly;
  phase: 'early' | 'mid' | 'late';
  actual: number;
  /** 着地の分位(19点。無ければ p10・p50・p90 の3点)と、その分位の水準。 */
  quantiles: readonly number[];
  levels: readonly number[];
  /** 単純な予想:「このペースのまま」(使った額 ÷ 経過日数 × 日数)と「先月と同じ」。 */
  naive: { pace: number; lastMonth: number };
  /** 出した注意の数と、実際に目標を超えた数(月末に、ジャンルの支出が目標より多かった)。 */
  cautions: { issued: number; hits: number };
};

function phaseOf(period: Period, asOf: DateOnly): EvalPoint['phase'] {
  const fraction = (daysBetween(period.from, asOf) + 1) / periodDays(period.from, period.to);
  return fraction <= 1 / 3 ? 'early' : fraction <= 2 / 3 ? 'mid' : 'late';
}

export function evaluate<State>(
  scenarios: readonly Scenario[],
  engine: EvalEngine<State>,
  payday: number,
  log: (message: string) => void = () => undefined,
): EvalPoint[] {
  const points: EvalPoint[] = [];
  for (const scenario of scenarios) {
    for (const period of scenario.months) {
      const actual = actualTotalForPeriod(scenario.transactions, period);
      const actualByCategory = actualByCategoryForPeriod(scenario.transactions, period);
      // 検証(補正)は月の初日に記録済みの、完了した月の明細で1回だけ求める。
      const atStart = knownTransactionsAt(scenario.transactions, period.from);
      const state = engine.verify({
        completed: atStart.filter((t) => t.occurredOn < period.from),
        today: period.from,
        payday,
      });
      const days = periodDays(period.from, period.to);
      for (let elapsed = 2; elapsed <= days - 1; elapsed += STEP_DAYS) {
        const asOf = addDays(period.from, elapsed - 1);
        const known = knownTransactionsAt(scenario.transactions, asOf);
        const {
          cautions = [],
          quantiles,
          ...q
        } = engine.forecast({
          known,
          period,
          today: asOf,
          payday,
          state,
        });
        const levels = quantiles ? QUANTILE_LEVELS : [0.1, 0.5, 0.9];
        points.push({
          ...q,
          quantiles: quantiles ?? [q.p10, q.p50, q.p90],
          levels,
          naive: naiveOf(known, period, asOf),
          cautions: {
            issued: cautions.length,
            hits: cautions.filter((c) => (actualByCategory.get(c.categoryId) ?? 0) > c.targetYen)
              .length,
          },
          scenario: scenario.name,
          period,
          asOf,
          phase: phaseOf(period, asOf),
          actual,
        });
      }
      log(`${scenario.name} ${period.from} 完了`);
    }
  }
  return points;
}

export const QUANTILE_LEVELS: readonly number[] = Array.from(
  { length: 19 },
  (_, i) => (i + 1) / 20,
);

/**
 * 単純な予想2つ(設計書 v3 5)。その時点で記録済みの明細だけで出す。
 * 先月の記録が無ければ「このままのペース」で代える。
 */
function naiveOf(
  known: readonly ForecastSourceTransaction[],
  period: Period,
  asOf: DateOnly,
): { pace: number; lastMonth: number } {
  const spent = actualTotalForPeriod(known, { from: period.from, to: asOf });
  const elapsed = daysBetween(period.from, asOf) + 1;
  const pace = (spent / Math.max(1, elapsed)) * periodDays(period.from, period.to);
  const prevFrom = addMonths(period.from, -1);
  const prevTo = addDays(period.from, -1);
  const hasPrev = known.some((t) => t.occurredOn >= prevFrom && t.occurredOn <= prevTo);
  const lastMonth = hasPrev ? actualTotalForPeriod(known, { from: prevFrom, to: prevTo }) : pace;
  return { pace, lastMonth };
}

/**
 * CRPS の近似:分位のピンボール損失の平均 × 2(分位が細かいほど CRPS に近い)。
 * 点の予想(全部の分位が同じ値)では、絶対誤差と同じになる。
 */
export function quantileCrps(
  quantiles: readonly number[],
  levels: readonly number[],
  y: number,
): number {
  let sum = 0;
  for (let i = 0; i < quantiles.length; i += 1) {
    const q = quantiles[i]!;
    const tau = levels[i]!;
    sum += y >= q ? tau * (y - q) : (1 - tau) * (q - y);
  }
  // 水準の和で割って2倍にする(点の予想で |誤差| になるように)。
  const tauMean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return sum / quantiles.length / tauMean;
}

/** PIT:実際の値が、予測の分布のどの位置か(分位の間を線形に補う)。 */
export function pitOf(quantiles: readonly number[], levels: readonly number[], y: number): number {
  const n = quantiles.length;
  if (n === 0) return 0.5;
  if (y <= quantiles[0]!) return levels[0]! / 2;
  if (y >= quantiles[n - 1]!) return (1 + levels[n - 1]!) / 2;
  for (let i = 1; i < n; i += 1) {
    if (y <= quantiles[i]!) {
      const lo = quantiles[i - 1]!;
      const hi = quantiles[i]!;
      const f = hi > lo ? (y - lo) / (hi - lo) : 0.5;
      return levels[i - 1]! + f * (levels[i]! - levels[i - 1]!);
    }
  }
  return levels[n - 1]!;
}

function quantileScore(p: EvalPoint): number {
  return quantileCrps(p.quantiles, p.levels, p.actual);
}

export type EvalMetrics = {
  count: number;
  coverage80: number;
  earlyCoverage80: number;
  /** (中央値 − 実際) ÷ 実際 の平均。 */
  bias: number;
  absError: number;
  score: number;
  /** 単純な予想2つの CRPS(点の予想なので絶対誤差)。 */
  naivePaceScore: number;
  naiveLastMonthScore: number;
  /** 設計書 v3 5.1 の偏り:Σ(実際 − 中央値) ÷ Σ実際。正は低く出ている。 */
  sumBias: number;
  /** PIT を10等分した各区間の割合(目標は各 7〜13%)。 */
  pitDeciles: number[];
  /** 注意の精度(出したうち、実際に超えた割合)と出した数。出していなければ null。 */
  cautionPrecision: number | null;
  cautionsIssued: number;
};

export function metricsOf(points: readonly EvalPoint[]): EvalMetrics {
  const n = Math.max(1, points.length);
  const early = points.filter((p) => p.phase === 'early');
  const within = (p: EvalPoint) => p.actual >= p.p10 && p.actual <= p.p90;
  return {
    count: points.length,
    coverage80: points.filter(within).length / n,
    earlyCoverage80: early.filter(within).length / Math.max(1, early.length),
    bias: points.reduce((s, p) => s + (p.p50 - p.actual) / Math.max(1, p.actual), 0) / n,
    absError:
      points.reduce((s, p) => s + Math.abs(p.p50 - p.actual) / Math.max(1, p.actual), 0) / n,
    score: points.reduce((s, p) => s + quantileScore(p), 0) / n,
    naivePaceScore: points.reduce((s, p) => s + Math.abs(p.naive.pace - p.actual), 0) / n,
    naiveLastMonthScore: points.reduce((s, p) => s + Math.abs(p.naive.lastMonth - p.actual), 0) / n,
    sumBias:
      points.reduce((s, p) => s + (p.actual - p.p50), 0) /
      Math.max(
        1,
        points.reduce((s, p) => s + p.actual, 0),
      ),
    pitDeciles: pitDecilesOf(points),
    ...cautionStats(points),
  };
}

function pitDecilesOf(points: readonly EvalPoint[]): number[] {
  const bins = Array.from({ length: 10 }, () => 0);
  for (const p of points) {
    const u = pitOf(p.quantiles, p.levels, p.actual);
    bins[Math.min(9, Math.floor(u * 10))]! += 1;
  }
  return bins.map((b) => b / Math.max(1, points.length));
}

function cautionStats(points: readonly EvalPoint[]): {
  cautionPrecision: number | null;
  cautionsIssued: number;
} {
  const issued = points.reduce((s, p) => s + p.cautions.issued, 0);
  const hits = points.reduce((s, p) => s + p.cautions.hits, 0);
  return { cautionPrecision: issued > 0 ? hits / issued : null, cautionsIssued: issued };
}
