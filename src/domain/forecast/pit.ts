/**
 * 確率の補正(PIT)。過去の月で、実際の着地が予測分布の何パーセント点に入ったか(u)を集め、
 * その分布 Ĝ で確率を読み替える:G(q) = a·Ĝ(q) + (1−a)·G₀(q)(a = 月数 ÷ (月数 + 6))。
 * G₀ は母集団の補正(設計書 v3 4.5)。無ければ G₀(q) = q(補正なし)。
 * 予測が狭すぎれば u は0と1の近くに寄り、G は分位を外側へ広げる。偏っていれば中央をずらす。
 * 確率は G(生の確率)、分位は「G(q) = 求めたい確率」となる q の分位を使う。
 */

/** 中心の補正は、検証の月数が少ないほど事前(母集団、無ければ1)に寄せる(この月数ぶんの事前の確信)。 */
export const CENTER_PRIOR_MONTHS = 8;

export type PitCalibration = {
  pit: readonly number[];
  pitWeight: number;
  /** 母集団の u の分位点(昇順)。本人の月が少ない分だけ、こちらを使う。 */
  prior?: readonly number[];
};

/** Ĝ(q):u が q 以下の割合(u は昇順)。 */
function empiricalCdf(sorted: readonly number[], q: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= q) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** 生の確率 q を、補正後の確率 G(q) にする。補正が無ければそのまま。 */
export function calibratedProbability(cal: PitCalibration | null | undefined, q: number): number {
  if (!cal) return q;
  const base = cal.prior && cal.prior.length > 0 ? quantileCdf(cal.prior, q) : q;
  if (cal.pit.length === 0 || cal.pitWeight <= 0) return base;
  return cal.pitWeight * empiricalCdf(cal.pit, q) + (1 - cal.pitWeight) * base;
}

/** 分位点(0〜1 の等間隔の水準での u の値、昇順)から、u ≤ q の割合を線形に補って求める。 */
function quantileCdf(points: readonly number[], q: number): number {
  const n = points.length;
  if (n === 1) return q <= points[0]! ? 0 : 1;
  if (q <= points[0]!) return 0;
  if (q >= points[n - 1]!) return 1;
  for (let i = 1; i < n; i += 1) {
    if (q <= points[i]!) {
      const lo = points[i - 1]!;
      const hi = points[i]!;
      const f = hi > lo ? (q - lo) / (hi - lo) : 0.5;
      return (i - 1 + f) / (n - 1);
    }
  }
  return 1;
}

/** 補正後に確率 alpha となる、生の分位の位置 q(G(q) ≥ alpha となる最小の q)。 */
export function rawLevelFor(cal: PitCalibration | null | undefined, alpha: number): number {
  if (!cal) return alpha;
  if ((cal.pit.length === 0 || cal.pitWeight <= 0) && !(cal.prior && cal.prior.length > 0)) {
    return alpha;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (calibratedProbability(cal, mid) >= alpha) hi = mid;
    else lo = mid;
  }
  return hi;
}
