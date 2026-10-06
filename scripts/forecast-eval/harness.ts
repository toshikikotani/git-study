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
import { addDays, daysBetween, type DateOnly } from '../../src/lib/date';

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
  }): Quantiles & { cautions?: readonly IssuedCaution[] };
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
        const { cautions = [], ...q } = engine.forecast({
          known,
          period,
          today: asOf,
          payday,
          state,
        });
        points.push({
          ...q,
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

/** 分位スコア(p10・p50・p90 のピンボール損失の平均 × 2)。CRPS の近似で、小さいほど良い。 */
function quantileScore(p: EvalPoint): number {
  const loss = (q: number, tau: number) =>
    p.actual >= q ? tau * (p.actual - q) : (1 - tau) * (q - p.actual);
  return ((loss(p.p10, 0.1) + loss(p.p50, 0.5) + loss(p.p90, 0.9)) * 2) / 3;
}

export type EvalMetrics = {
  count: number;
  coverage80: number;
  earlyCoverage80: number;
  /** (中央値 − 実際) ÷ 実際 の平均。 */
  bias: number;
  absError: number;
  score: number;
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
    ...cautionStats(points),
  };
}

function cautionStats(points: readonly EvalPoint[]): {
  cautionPrecision: number | null;
  cautionsIssued: number;
} {
  const issued = points.reduce((s, p) => s + p.cautions.issued, 0);
  const hits = points.reduce((s, p) => s + p.cautions.hits, 0);
  return { cautionPrecision: issued > 0 ? hits / issued : null, cautionsIssued: issued };
}
