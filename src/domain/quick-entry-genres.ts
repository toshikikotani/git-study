/**
 * 手入力のカテゴリ格子の並び順(N2本人要件「並び順は使用頻度の順に自動で
 * 並べ替え、長押しで手動の並べ替えと非表示ができる」)。
 *
 * quickEntryOrder が入っている(=本人が長押しで並べ替えたことがある)ジャンルは
 * その値の昇順を最優先にする。残りは使用頻度(usageCount)の多い順、同数なら
 * 名前順で安定させる。hiddenInQuickEntry のジャンルは結果に含めない。
 */
export type QuickEntryGenreInput = {
  id: string;
  name: string;
  quickEntryOrder: number | null;
  hiddenInQuickEntry: boolean;
  usageCount: number;
};

export function sortQuickEntryGenres<T extends QuickEntryGenreInput>(genres: readonly T[]): T[] {
  return genres
    .filter((g) => !g.hiddenInQuickEntry)
    .slice()
    .sort((a, b) => {
      const aManual = a.quickEntryOrder !== null;
      const bManual = b.quickEntryOrder !== null;
      if (aManual && bManual) return a.quickEntryOrder! - b.quickEntryOrder!;
      if (aManual !== bManual) return aManual ? -1 : 1;
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name, 'ja');
    });
}
