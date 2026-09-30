/**
 * グラフの右端の余白(ガッター)に置く、金額の目盛りと「目安」「平均」のタグの配置(純粋関数)。
 * どのラベルも描画領域の外(右の余白)に置き、互いに重ならないよう上下にずらす。
 * 目盛りは補助的なので、タグと近すぎるときは目盛りのほうを外す。
 */

export type GutterItem = {
  key: string;
  kind: 'tick' | 'tag';
  /** 縦軸上の位置(0=下端、1=上端)。 */
  ratio: number;
  /** ラベルの高さ(px)。 */
  height: number;
};

export type GutterPlacement = GutterItem & {
  /** 描画領域の上端からの、ラベルの中心の位置(px)。 */
  centerPx: number;
  /** 元の位置からずらしたか(ずらしたときは細い引き出し線を添える)。 */
  shifted: boolean;
};

export const TAG_HEIGHT = 34; // 2行(「目安」/ 金額)
export const TICK_HEIGHT = 18;
const PAD = 2;

/**
 * @param plotPx 描画領域の高さ(px)
 */
export function layoutGutter(items: readonly GutterItem[], plotPx: number): GutterPlacement[] {
  const centerOf = (i: GutterItem) => (1 - Math.min(Math.max(i.ratio, 0), 1)) * plotPx;
  const tags = items.filter((i) => i.kind === 'tag');
  // 目盛りは、タグと重なるものを外す。
  const kept = items.filter((i) => {
    if (i.kind === 'tag') return true;
    return tags.every(
      (t) => Math.abs(centerOf(t) - centerOf(i)) >= (t.height + i.height) / 2 + PAD,
    );
  });
  const sorted = kept
    .map((i) => ({ ...i, centerPx: centerOf(i), shifted: false }))
    .sort((a, b) => a.centerPx - b.centerPx);

  // 上から順に、前のラベルと重ならない位置へ押し下げる。
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const min = cur.height / 2;
    let c = Math.max(cur.centerPx, min);
    if (i > 0) {
      const prev = sorted[i - 1]!;
      c = Math.max(c, prev.centerPx + (prev.height + cur.height) / 2 + PAD);
    }
    if (c !== cur.centerPx) {
      cur.centerPx = c;
      cur.shifted = true;
    }
  }
  // 下にはみ出したら、下から順に押し上げる。
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const cur = sorted[i]!;
    const max = plotPx - cur.height / 2;
    let c = Math.min(cur.centerPx, max);
    if (i < sorted.length - 1) {
      const next = sorted[i + 1]!;
      c = Math.min(c, next.centerPx - (next.height + cur.height) / 2 - PAD);
    }
    if (c !== cur.centerPx) {
      cur.centerPx = c;
      cur.shifted = true;
    }
  }
  return sorted;
}

/** すべてのラベルが描画領域の中に収まり、互いに重ならないか(テスト・検証用)。 */
export function gutterIsValid(placed: readonly GutterPlacement[], plotPx: number): boolean {
  const s = [...placed].sort((a, b) => a.centerPx - b.centerPx);
  for (let i = 0; i < s.length; i += 1) {
    const p = s[i]!;
    if (p.centerPx - p.height / 2 < -0.01 || p.centerPx + p.height / 2 > plotPx + 0.01)
      return false;
    if (i > 0) {
      const q = s[i - 1]!;
      if (p.centerPx - q.centerPx < (p.height + q.height) / 2 - 0.01) return false;
    }
  }
  return true;
}
