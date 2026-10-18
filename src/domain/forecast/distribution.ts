import { calibratedProbability, type PitCalibration } from './pit';

/** 同じ試行とPIT補正を、見出し・分布・金額の選択で共有する。整数円の閾値を保つため試行は切り上げる。 */
export type ForecastDistribution = {
  amounts: readonly number[];
  calibration: PitCalibration | null;
};

export function forecastDistribution(
  sorted: ArrayLike<number>,
  calibration: PitCalibration | null,
): ForecastDistribution {
  return { amounts: Array.from(sorted, Math.ceil), calibration };
}

/** 有限の試行の支持域を保ち、補正によって不可能な金額を復活させない。 */
export function trialProbability(
  calibration: PitCalibration | null,
  within: number,
  trials: number,
): number {
  if (trials <= 0 || within <= 0) return 0;
  if (within >= trials) return 1;
  return calibratedProbability(calibration, within / trials);
}

/** P(着地 <= yen)。試行の範囲外へ正規分布を外挿しない。同額の試行もすべて数える。 */
export function probabilityAt(distribution: ForecastDistribution, yen: number): number {
  const { amounts, calibration } = distribution;
  const n = amounts.length;
  if (n === 0 || Number.isNaN(yen) || yen < amounts[0]!) return 0;
  if (yen >= amounts[n - 1]!) return 1;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (amounts[mid]! <= yen) lo = mid + 1;
    else hi = mid;
  }
  return trialProbability(calibration, lo, n);
}

/**
 * 各棒は (from, to] の確率。目標で境界を分け、左側の棒の面積を目標内の確率と一致させる。
 * 描画の高さは probability / (to - from) にする(目標で分けた棒だけ幅が異なるため)。
 * 描画範囲は最小試行より小さい min、最大試行以上の max を渡す(端点の同額試行も含める)。
 */
export function histogram(
  distribution: ForecastDistribution,
  options: { min: number; max: number; bins: number; threshold?: number },
): { from: number; to: number; probability: number }[] {
  const { min, max, threshold } = options;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const count = Math.max(1, Math.min(100, Math.floor(options.bins) || 1));
  const edges = Array.from({ length: count + 1 }, (_, i) => min + ((max - min) * i) / count);
  if (threshold !== undefined && threshold > min && threshold < max) edges.push(threshold);
  edges.sort((a, b) => a - b);
  const unique = edges.filter((edge, i) => i === 0 || edge !== edges[i - 1]);
  // min は描画範囲の左端。min と同額の試行も最初の棒に含める。
  let previous = 0;
  return unique.slice(1).map((to, i) => {
    const next = probabilityAt(distribution, to);
    const probability = Math.max(0, next - previous);
    previous = next;
    return { from: unique[i]!, to, probability };
  });
}
