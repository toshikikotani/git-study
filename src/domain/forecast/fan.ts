/**
 * M6:扇形のグラフ(累計の実績の先に、中央と帯を描く)の日ごとの値。
 *
 * シミュレーションは性能のため「残り期間の合計」だけを引く(simulate.ts)。
 * 途中の日の分布は、合計の分布から次の近似で作る(docs/decisions.md):
 *   中央  = 今日の累計 + (着地の中央 − 今日の累計) × 経過割合
 *   帯の幅 = 着地の帯の片側の幅 × √経過割合
 * ポアソン的な積み上がりは分散が経過時間に比例して増える(幅は平方根に比例)
 * ため、月末で着地の帯と一致し、今日で幅0になる。
 */

export type FanBand = { p10: number; p25: number; p50: number; p75: number; p90: number };

/** 着地の p10/p50/p90 から 10回中5回(p25〜p75)の幅を近似する比。正規近似で 0.6745/1.2816。 */
const HALF_TO_EIGHTY = 0.6745 / 1.2816;

export function fanAt(input: {
  todayCumulative: number;
  landing: { p10: number; p50: number; p90: number };
  /** 今日を0、期間の最終日を1とした割合。 */
  fraction: number;
}): FanBand {
  const f = Math.max(0, Math.min(1, input.fraction));
  const { todayCumulative: base, landing } = input;
  const p50 = base + (landing.p50 - base) * f;
  const spread = Math.sqrt(f);
  const down = Math.max(0, landing.p50 - landing.p10) * spread;
  const up = Math.max(0, landing.p90 - landing.p50) * spread;
  // 実績は減らないため、帯の下端は今日の累計を下回らない。
  return {
    p10: Math.max(base, p50 - down),
    p25: Math.max(base, p50 - down * HALF_TO_EIGHTY),
    p50,
    p75: p50 + up * HALF_TO_EIGHTY,
    p90: p50 + up,
  };
}
