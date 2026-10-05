/**
 * 確率の補正(PIT)。過去の月で、実際の着地が予測分布の何パーセント点に入ったか(u)を集め、
 * その分布 Ĝ で確率を読み替える:G(q) = a·Ĝ(q) + (1−a)·q(a = 月数 ÷ (月数 + 6))。
 * 予測が狭すぎれば u は0と1の近くに寄り、G は分位を外側へ広げる。偏っていれば中央をずらす。
 * 確率は G(生の確率)、分位は「G(q) = 求めたい確率」となる q の分位を使う。
 */

export type PitCalibration = { pit: readonly number[]; pitWeight: number };

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
  if (!cal || cal.pit.length === 0 || cal.pitWeight <= 0) return q;
  return cal.pitWeight * empiricalCdf(cal.pit, q) + (1 - cal.pitWeight) * q;
}

/** 補正後に確率 alpha となる、生の分位の位置 q(G(q) ≥ alpha となる最小の q)。 */
export function rawLevelFor(cal: PitCalibration | null | undefined, alpha: number): number {
  if (!cal || cal.pit.length === 0 || cal.pitWeight <= 0) return alpha;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (calibratedProbability(cal, mid) >= alpha) hi = mid;
    else lo = mid;
  }
  return hi;
}
