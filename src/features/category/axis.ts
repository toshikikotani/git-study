/**
 * 横軸のラベルの選び方(純粋関数)。最大5個、折り返さず、重ならない。
 * 幅は文字数からの見積もり(1文字あたり charPx)。実際の幅がこれより広ければ、より余裕が出る。
 */

export type AxisItem = { index: number; text: string };

export const AXIS_MAX_LABELS = 5;

export function estimateWidth(text: string, charPx = 7.5): number {
  let w = 0;
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? charPx * 1.6 : charPx;
  return w;
}

/**
 * @param labels 全区間のラベル
 * @param plotPx 描画領域の幅の見積もり(狭い側で見積もる)
 * @param firstText 先頭だけの別の文言(例:「9/21 記録開始」)
 */
export function pickAxisLabels(
  labels: readonly string[],
  plotPx = 280,
  firstText?: string,
  max = AXIS_MAX_LABELS,
  charPx = 7.5,
): AxisItem[] {
  const n = labels.length;
  if (n === 0) return [];
  const want = Math.min(max, n);
  const idx: number[] = [];
  for (let k = 0; k < want; k += 1) {
    idx.push(want === 1 ? 0 : Math.round((k * (n - 1)) / (want - 1)));
  }
  let items: AxisItem[] = [...new Set(idx)].map((i) => ({
    index: i,
    text: i === 0 && firstText ? firstText : labels[i]!,
  }));

  // 左端は左揃え、右端は右揃え、それ以外は中央揃えとして、隣どうしの間が空くまで間引く。
  const span = (it: AxisItem) => {
    const w = estimateWidth(it.text, charPx);
    const x = n === 1 ? plotPx / 2 : ((it.index + 0.5) / n) * plotPx;
    if (it.index === 0) return [0, w] as const;
    if (it.index === n - 1) return [plotPx - w, plotPx] as const;
    return [x - w / 2, x + w / 2] as const;
  };
  const overlaps = (list: AxisItem[]) => {
    for (let i = 1; i < list.length; i += 1) {
      if (span(list[i]!)[0] < span(list[i - 1]!)[1] + 8) return i;
    }
    return -1;
  };
  for (let guard = 0; guard < 10; guard += 1) {
    const at = overlaps(items);
    if (at < 0) break;
    // 重なった組のうち、端(先頭・末尾)でないほうを外す。
    const isLast = at === items.length - 1;
    const drop = isLast && at - 1 > 0 ? at - 1 : at;
    if (items.length <= 1) break;
    items = items.filter((_, i) => i !== drop);
  }
  return items;
}
