/** 一覧のカテゴリ・品目要約。保存値や集計値は変えず、表示だけを揃える。 */
type RowCategory = {
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
};

export type LedgerRowPresentationInput = {
  name: string;
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  items?: readonly (RowCategory & { name: string })[];
  splits?: readonly RowCategory[];
};

export type LedgerRowPresentation = {
  name: string;
  genreId: string | null;
  genreName: string | null;
  /** 単一カテゴリは名前、複数カテゴリは名前を中黒で結んだ文字列。 */
  categoryText: string;
  /** 最初の品目と、残りの品目数。 */
  itemSummary: string;
  otherItemCount: number;
  subtitle: string;
  /** 絶対額の大きい順。同額では元の並びを保つ。 */
  breakdown: readonly RowCategory[];
};

/** 「株式会社」を一覧の店名だけで省略する。元の摘要や編集欄には適用しない。 */
export function compactLedgerName(name: string): string {
  return name.replaceAll('株式会社', '').trim() || '店名なし';
}

export function ledgerRowPresentation(input: LedgerRowPresentationInput): LedgerRowPresentation {
  const items = input.items ?? [];
  const splits = input.splits ?? [];
  // カテゴリが読み取れている品目があれば、親の店カテゴリより品目を優先。
  // 全品目が未分類のときは、保存済みの分割 → 親カテゴリへ戻る。
  const categorizedItems = items.filter((item) => item.genreId !== null || item.genreName !== null);
  const source =
    categorizedItems.length > 0
      ? categorizedItems
      : splits.length > 0
        ? splits
        : [{ genreId: input.genreId, genreName: input.genreName, amountYen: input.amountYen }];
  const byCategory = new Map<string, RowCategory>();
  for (const row of source) {
    const key = row.genreId !== null ? `id:${row.genreId}` : `name:${row.genreName ?? ''}`;
    const current = byCategory.get(key);
    if (current) {
      current.amountYen += Math.abs(row.amountYen);
    } else {
      byCategory.set(key, {
        genreId: row.genreId,
        genreName: row.genreName,
        amountYen: Math.abs(row.amountYen),
      });
    }
  }
  const breakdown = [...byCategory.values()].sort((a, b) => b.amountYen - a.amountYen);
  const primary = breakdown[0]!;
  const categoryText = breakdown.map((row) => row.genreName ?? '未分類').join('・');
  const firstName = items[0]?.name ?? '';
  const itemSummary =
    firstName === '' ? '' : `${firstName}${items.length > 1 ? ` ほか${items.length - 1}` : ''}`;
  return {
    name: compactLedgerName(input.name),
    genreId: primary.genreId,
    genreName: primary.genreName,
    categoryText,
    itemSummary,
    otherItemCount: Math.max(0, items.length - 1),
    subtitle: [categoryText, itemSummary].filter(Boolean).join(' · '),
    breakdown,
  };
}
