/**
 * 支出のジャンル別集計(本人発案「投資家目線で客観的にジャンル細分化する
 * AIを作ってほしい。第三者の分類があると第三者目線での分析ができる」、
 * ADR-056)。
 *
 * `category_kind`・カテゴリ名は本人が決めた主観的な分類。ここでのジャンルは
 * AIが明細・品目の中身から機械的に割り当てる客観的な分類で、両者は独立した
 * 別の軸——同じ「浪費」カテゴリでも実際には外食が大半なのか酒が大半なのかを、
 * 本人の主観を介さずに見せる。
 *
 * ジャンルの一覧そのものは固定enumではなく、`categories` と同じく本人が
 * 自由に追加・削除できるDBテーブル(`genres`)で管理する(本人発案「カテゴリは
 * dbに保存してenumじゃなくて、自由に変更できる仕組みに。追加削除容易に
 * したい」)。そのため識別子は文字列リテラルの合併型ではなく `genreId`
 * (uuid)で扱う。`domain/diagnosis.ts`(浪費/必要経費のAI診断)と同じく
 * 判断そのものはAI呼び出し側の責務で、ここは集計する純粋関数だけを持つ。
 */

/** ジャンル分類済みの1件(明細全体、またはレシート品目1点)。 */
export type GenredEntry = {
  genreId: string;
  genreName: string;
  /** 正の金額(支出の大きさ)。 */
  amountYen: number;
  /** 本人が付けたカテゴリ名。未分類なら null。 */
  categoryName: string | null;
};

export type GenreTotal = { genreId: string; genreName: string; totalYen: number };

/** ジャンルごとの合計、金額の大きい順。 */
export function summarizeByGenre(entries: readonly GenredEntry[]): GenreTotal[] {
  const byGenre = new Map<string, GenreTotal>();
  for (const entry of entries) {
    const current = byGenre.get(entry.genreId) ?? {
      genreId: entry.genreId,
      genreName: entry.genreName,
      totalYen: 0,
    };
    current.totalYen += entry.amountYen;
    byGenre.set(entry.genreId, current);
  }
  return [...byGenre.values()].sort((a, b) => b.totalYen - a.totalYen);
}

export type CategoryGenreBreakdown = {
  categoryName: string;
  totalYen: number;
  genres: readonly GenreTotal[];
};

/**
 * 本人のカテゴリごとに、その中身がどのジャンルで構成されているかを見せる
 * (本人発案の核心「生活費や浪費などユーザーが決めたやつに対して客観的に
 * 何のジャンルか」)。カテゴリ・合計額の大きい順。
 */
export function summarizeGenreByCategory(
  entries: readonly GenredEntry[],
): CategoryGenreBreakdown[] {
  const byCategory = new Map<string, GenredEntry[]>();
  for (const entry of entries) {
    const key = entry.categoryName ?? '未分類';
    const list = byCategory.get(key) ?? [];
    list.push(entry);
    byCategory.set(key, list);
  }

  return [...byCategory.entries()]
    .map(([categoryName, list]) => ({
      categoryName,
      totalYen: list.reduce((sum, e) => sum + e.amountYen, 0),
      genres: summarizeByGenre(list),
    }))
    .sort((a, b) => b.totalYen - a.totalYen);
}
