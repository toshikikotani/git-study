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
  /** その時点ですでに決まっている額(実績 + 予定 + 固定費)。残りの予測の誤差を測る起点。 */
  knownYen: number;
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
  /** 直近を重く見る重みの半減期(日)。 */
  halfLifeDays?: number;
  /** 「予測を止める」にしたジャンル(本番と同じ扱いで検証する)。 */
  noForecastGenreIds?: ReadonlySet<string>;
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
        halfLifeDays: input.halfLifeDays,
        noForecastGenreIds: input.noForecastGenreIds,
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
        knownYen: simulateInput.actualYen + simulateInput.committedYen,
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

export type CalibrationResult = {
  widthFactor: number;
  sampleSize: number;
  /**
   * 残りの予測の中心を動かす係数(1=そのまま)。検証で、残りの実際の支出が予測の中央値より
   * 系統的に多かった(少なかった)ときに、その比で残りの部分を補正する。
   */
  centerFactor: number;
};

/** コンフォーマル予測による補正(M4)を、必要な最小件数が無ければ既定値(1=補正なし)にする。 */
export const MIN_BACKTEST_POINTS_FOR_CALIBRATION = 6;
const MIN_WIDTH_FACTOR = 0.5;
const MAX_WIDTH_FACTOR = 3;
const MIN_CENTER_FACTOR = 0.75;
const MAX_CENTER_FACTOR = 1.4;
/** 中心の補正は、検証の件数が少ないほど1に寄せる(この件数ぶんの事前の確信)。 */
const CENTER_PRIOR_POINTS = 8;

/**
 * 残りの予測(p50 − 決まっている額)に対する、実際の残り(実績 − 決まっている額)の比。
 * 件数が少ないほど1へ寄せ、極端な係数にならないよう範囲に収める。
 */
export function calibrateCenter(points: readonly BacktestPoint[]): number {
  if (points.length < MIN_BACKTEST_POINTS_FOR_CALIBRATION) return 1;
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
  const weight = points.length / (points.length + CENTER_PRIOR_POINTS);
  return Math.min(MAX_CENTER_FACTOR, Math.max(MIN_CENTER_FACTOR, 1 + weight * (raw - 1)));
}

/** 残りの部分だけを係数で動かす(決まっている額 known はそのまま)。 */
export function shiftRemaining(value: number, known: number, factor: number): number {
  return known + (value - known) * factor;
}

/**
 * バックテストの外れ方から、中心(残りの係数)と幅の広さを補正する係数を求める
 * (split conformal prediction と同じ考え方)。先に中心を補正し、補正後の外れ方で幅を決める。
 * 幅は、実際の着地が p50 から何「半分の帯幅」ぶん外れていたか(deviation)の、目標
 * カバレッジ(80%)に対応する分位点。1より大きければ元の帯は狭すぎた(広げる)。
 */
export function calibrateWidth(
  points: readonly BacktestPoint[],
  targetCoverage = 0.8,
): CalibrationResult {
  if (points.length < MIN_BACKTEST_POINTS_FOR_CALIBRATION) {
    return { widthFactor: 1, sampleSize: points.length, centerFactor: 1 };
  }
  const centerFactor = calibrateCenter(points);
  const deviations = points
    .map((p) => {
      const p10 = shiftRemaining(p.p10, p.knownYen, centerFactor);
      const p50 = shiftRemaining(p.p50, p.knownYen, centerFactor);
      const p90 = shiftRemaining(p.p90, p.knownYen, centerFactor);
      const halfWidth = Math.max(1, (p90 - p10) / 2);
      return Math.abs(p.actualTotal - p50) / halfWidth;
    })
    .sort((a, b) => a - b);
  const idx = Math.min(
    deviations.length - 1,
    Math.max(0, Math.ceil(targetCoverage * deviations.length) - 1),
  );
  const widthFactor = Math.min(MAX_WIDTH_FACTOR, Math.max(MIN_WIDTH_FACTOR, deviations[idx]!));
  return { widthFactor, sampleSize: points.length, centerFactor };
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
