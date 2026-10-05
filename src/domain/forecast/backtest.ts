/**
 * M4:検証と補正。過去に終わった期間について、期間内の複数時点(チェックポイント)
 * から予測を作り直し、実際の着地額と比べる。
 *
 * スコープの簡略化(docs/decisions.md 参照):
 *   - 固定費の検出(confirmedFixedKeys)は過去の各チェックポイント時点の状態を
 *     再現するのが難しいため、バックテストでは常に「確認済みの固定費なし」で
 *     計算する(固定費は決定的な確定値のため、変動費モデルの当たり外れの
 *     検証には影響しない)。
 *   - モデル選択(ベイズ/ブートストラップ/アンサンブル)は、カテゴリごとではなく
 *     世帯全体の合計額の CRPS で比較する(カテゴリごとの再標本化プールが
 *     チェックポイントごとに小さくなりすぎ、個別に検証するにはデータが
 *     足りないことが多いため)。
 */

import { addDays, type DateOnly } from '@/lib/date';
import { periodDays } from '@/domain/period';
import type { ForecastSourceTransaction } from './decompose';
import { prepareSimulation } from './pipeline';
import { DEFAULT_TRIALS, simulateTotalSamples } from './simulate';

function quantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx]!;
}

/** バックテストで見る時点(期間の経過割合)。本人要件の「1日目・3日目・半分・残り2日」に対応。 */
export function backtestCheckpoints(periodFromDays: number): readonly number[] {
  const fractions = [
    1 / periodFromDays,
    3 / periodFromDays,
    0.5,
    (periodFromDays - 2) / periodFromDays,
  ];
  return [...new Set(fractions.map((f) => Math.min(0.95, Math.max(0.02, f))))].sort(
    (a, b) => a - b,
  );
}

export type BacktestPoint = {
  periodFrom: DateOnly;
  periodTo: DateOnly;
  asOf: DateOnly;
  actualTotal: number;
  p10: number;
  p50: number;
  p90: number;
  hitWithin80: boolean;
  crps: number;
};

export type BacktestSummary = {
  points: readonly BacktestPoint[];
  hitRate80: number;
  medianAbsErrorRatio: number;
  meanCrps: number;
};

/** 実際の合計額(通常支出のみ、期間全体)。バックテストの正解ラベルに使う。 */
function actualTotalForPeriod(
  transactions: readonly ForecastSourceTransaction[],
  period: { from: DateOnly; to: DateOnly },
): number {
  return transactions
    .filter(
      (t) =>
        t.kind === 'normal' &&
        !t.isTransfer &&
        t.reviewStatus !== 'ignored' &&
        !t.needsInput &&
        t.amountYen < 0 &&
        t.occurredOn >= period.from &&
        t.occurredOn <= period.to,
    )
    .reduce((sum, t) => sum + -t.amountYen, 0);
}

/** 経験的CRPS(エネルギースコア近似)。試行数が多いと O(n^2) になるため、内部で間引く。 */
export function empiricalCrps(samples: Float64Array, actual: number, maxSamples = 400): number {
  const n = samples.length;
  if (n === 0) return 0;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const xs: number[] = [];
  for (let i = 0; i < n; i += step) xs.push(samples[i]!);
  const m = xs.length;
  let term1 = 0;
  for (const x of xs) term1 += Math.abs(x - actual);
  term1 /= m;
  let term2 = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < m; j += 1) term2 += Math.abs(xs[i]! - xs[j]!);
  }
  term2 /= 2 * m * m;
  return term1 - term2;
}

export function runBacktest(input: {
  transactions: readonly ForecastSourceTransaction[];
  /** バックテスト対象の、既に終わった期間。 */
  periods: readonly { from: DateOnly; to: DateOnly }[];
  trainingWindowDays: number;
  recordStart: DateOnly | null;
  /** 給料日(1〜31)。本番と同じ設定で検証する。 */
  payday?: number | null;
  bootstrapWeight: number;
  trials?: number;
}): BacktestSummary {
  const points: BacktestPoint[] = [];
  const trials = input.trials ?? Math.min(DEFAULT_TRIALS, 2000);

  for (const period of input.periods) {
    const days = periodDays(period.from, period.to);
    if (days < 5) continue;
    const actualTotal = actualTotalForPeriod(input.transactions, period);

    for (const fraction of backtestCheckpoints(days)) {
      const elapsed = Math.max(1, Math.min(days - 1, Math.round(fraction * days)));
      const asOf = addDays(period.from, elapsed - 1);
      const trainingFrom = addDays(asOf, -input.trainingWindowDays);

      // asOf 時点で知り得た明細だけを使う(未来のデータを混ぜない)。
      const knownTransactions = input.transactions.filter((t) => t.occurredOn <= asOf);

      const periodId = `${period.from}_${period.to}`;
      // 本番と同じ手順(pipeline.ts)で入力を作る。検証が本番と違うと当たり率が意味を持たない。
      const { simulateInput } = prepareSimulation({
        transactions: knownTransactions,
        period,
        today: asOf,
        trainingFrom,
        recordStart: input.recordStart,
        confirmedFixedKeys: new Set(),
        detectedSubscriptions: [],
        budgetYen: null,
        payday: input.payday ?? null,
        bootstrapWeight: input.bootstrapWeight,
        trials,
        seed: `backtest:${periodId}:${asOf}`,
      });
      const rawSamples = simulateTotalSamples(simulateInput);
      const sorted = Array.from(rawSamples).sort((a, b) => a - b);
      const forecast = {
        total: {
          p10: quantile(sorted, 0.1),
          p50: quantile(sorted, 0.5),
          p90: quantile(sorted, 0.9),
        },
      };

      points.push({
        periodFrom: period.from,
        periodTo: period.to,
        asOf,
        actualTotal,
        p10: forecast.total.p10,
        p50: forecast.total.p50,
        p90: forecast.total.p90,
        hitWithin80: actualTotal >= forecast.total.p10 && actualTotal <= forecast.total.p90,
        crps: empiricalCrps(rawSamples, actualTotal),
      });
    }
  }

  const hitRate80 =
    points.length > 0 ? points.filter((p) => p.hitWithin80).length / points.length : 0;
  const medianAbsErrorRatio =
    points.length > 0
      ? points.reduce(
          (sum, p) => sum + Math.abs(p.p50 - p.actualTotal) / Math.max(1, p.actualTotal),
          0,
        ) / points.length
      : 0;
  const meanCrps =
    points.length > 0 ? points.reduce((sum, p) => sum + p.crps, 0) / points.length : 0;

  return { points, hitRate80, medianAbsErrorRatio, meanCrps };
}

export type CalibrationResult = { widthFactor: number; sampleSize: number };

/** コンフォーマル予測による幅の補正(M4)を、必要な最小件数が無ければ既定値(1=補正なし)にする。 */
export const MIN_BACKTEST_POINTS_FOR_CALIBRATION = 6;
const MIN_WIDTH_FACTOR = 0.5;
const MAX_WIDTH_FACTOR = 3;

/**
 * バックテストの外れ方から、幅の広さを調整する係数を求める(split conformal
 * prediction と同じ考え方)。実際の着地が p50 から何「半分の帯幅」ぶん外れて
 * いたか(deviation)を集め、目標カバレッジ(80%)に対応する分位点を widthFactor
 * とする。1より大きければ元の帯は狭すぎた(広げる)、小さければ広すぎた(狭める)。
 */
export function calibrateWidth(
  points: readonly BacktestPoint[],
  targetCoverage = 0.8,
): CalibrationResult {
  if (points.length < MIN_BACKTEST_POINTS_FOR_CALIBRATION) {
    return { widthFactor: 1, sampleSize: points.length };
  }
  const deviations = points
    .map((p) => {
      const halfWidth = Math.max(1, (p.p90 - p.p10) / 2);
      return Math.abs(p.actualTotal - p.p50) / halfWidth;
    })
    .sort((a, b) => a - b);
  const idx = Math.min(
    deviations.length - 1,
    Math.max(0, Math.ceil(targetCoverage * deviations.length) - 1),
  );
  const widthFactor = Math.min(MAX_WIDTH_FACTOR, Math.max(MIN_WIDTH_FACTOR, deviations[idx]!));
  return { widthFactor, sampleSize: points.length };
}

/** widthFactor を p10/p50/p90 に適用する(p50 を中心に、片側ずつ伸縮させる)。 */
export function applyWidthFactor(
  band: { p10: number; p50: number; p90: number },
  widthFactor: number,
): { p10: number; p50: number; p90: number } {
  return {
    p10: band.p50 - (band.p50 - band.p10) * widthFactor,
    p50: band.p50,
    p90: band.p50 + (band.p90 - band.p50) * widthFactor,
  };
}

export type ModelSelection = {
  bootstrapWeight: number;
  method: 'bayes' | 'bootstrap' | 'ensemble';
  crpsByMethod: { bayes: number; bootstrap: number; ensemble: number };
  sampleSize: number;
};

const MIN_BACKTEST_POINTS_FOR_MODEL_SELECTION = 6;

/**
 * カテゴリごとではなく世帯全体で、ベイズ/ブートストラップ/アンサンブルの
 * どれが最も CRPS が良いかを比べ、bootstrapWeight を選ぶ(M4、スコープの
 * 簡略化は本ファイル冒頭のコメント参照)。バックテストの点数が少なければ
 * (検証できないほど記録が短ければ)ベイズモデルだけを使う。
 */
export function selectModel(input: {
  transactions: readonly ForecastSourceTransaction[];
  periods: readonly { from: DateOnly; to: DateOnly }[];
  trainingWindowDays: number;
  recordStart: DateOnly | null;
  payday?: number | null;
  trials?: number;
}): ModelSelection {
  const bayes = runBacktest({ ...input, bootstrapWeight: 0 });
  if (bayes.points.length < MIN_BACKTEST_POINTS_FOR_MODEL_SELECTION) {
    return {
      bootstrapWeight: 0,
      method: 'bayes',
      crpsByMethod: { bayes: bayes.meanCrps, bootstrap: NaN, ensemble: NaN },
      sampleSize: bayes.points.length,
    };
  }
  const bootstrap = runBacktest({ ...input, bootstrapWeight: 1 });
  const ensemble = runBacktest({ ...input, bootstrapWeight: 0.5 });
  const candidates = [
    { method: 'bayes' as const, weight: 0, crps: bayes.meanCrps },
    { method: 'bootstrap' as const, weight: 1, crps: bootstrap.meanCrps },
    { method: 'ensemble' as const, weight: 0.5, crps: ensemble.meanCrps },
  ];
  const best = candidates.reduce((a, b) => (b.crps < a.crps ? b : a));
  return {
    bootstrapWeight: best.weight,
    method: best.method,
    crpsByMethod: {
      bayes: bayes.meanCrps,
      bootstrap: bootstrap.meanCrps,
      ensemble: ensemble.meanCrps,
    },
    sampleSize: bayes.points.length,
  };
}
