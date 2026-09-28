/**
 * 支出のジャンル別集計(本人発案「投資家目線で客観的にジャンル細分化する
 * AIを作ってほしい」、ADR-056)。
 *
 * ADR-057で、ジャンルは本人が決めていた主観的なカテゴリ(生活費・浪費など)
 * を置き換える唯一の分類になった。「絶対払わざるを得ないもの」の判断は
 * ジャンルとは独立した軸(`transactions.must_pay`、明細1件ごとに本人が
 * 個別に付ける)として持たせてあり、ジャンル別の内訳を必須/裁量でさらに
 * 割って見せられる。
 */

/** ジャンル分類済みの1件(明細全体、またはレシート品目1点)。 */
export type GenredEntry = {
  genreId: string;
  genreName: string;
  /** 正の金額(支出の大きさ)。 */
  amountYen: number;
  /** 本人発案「絶対払わざるを得ないもの」のラベル(明細1件ごと)。 */
  mustPay: boolean;
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

export type MustPaySplit = {
  /** 絶対払わざるを得ないものの合計。 */
  mustPayYen: number;
  /** それ以外(裁量的な支出)の合計。 */
  discretionaryYen: number;
};

/**
 * 「絶対払わざるを得ないもの」とそれ以外の合計(本人発案「グラフで表示分け
 * できるように」)。
 */
export function summarizeMustPaySplit(entries: readonly GenredEntry[]): MustPaySplit {
  let mustPayYen = 0;
  let discretionaryYen = 0;
  for (const entry of entries) {
    if (entry.mustPay) {
      mustPayYen += entry.amountYen;
    } else {
      discretionaryYen += entry.amountYen;
    }
  }
  return { mustPayYen, discretionaryYen };
}

/**
 * 明細本体にジャンルが無いとき、レシート品目のジャンルから明細の代表ジャンルを
 * 決める。品目がすべて分類済みなら、金額が最大のジャンル(同額なら先に現れた方)。
 * 1件でも未分類の品目が残っていれば null(まだ「未分類」のまま、その品目が
 * 次回のジャンル分類の対象になる)。明細本体に既にジャンルがあればそれを優先する。
 */
export function effectiveGenreId(
  transactionGenreId: string | null,
  items: readonly { genreId: string | null; amountYen: number }[],
): string | null {
  if (transactionGenreId !== null) return transactionGenreId;
  if (items.length === 0 || items.some((item) => item.genreId === null)) return null;

  const totalByGenre = new Map<string, number>();
  for (const item of items) {
    totalByGenre.set(
      item.genreId!,
      (totalByGenre.get(item.genreId!) ?? 0) + Math.abs(item.amountYen),
    );
  }
  let best: { genreId: string; totalYen: number } | null = null;
  for (const [genreId, totalYen] of totalByGenre) {
    if (best === null || totalYen > best.totalYen) best = { genreId, totalYen };
  }
  return best?.genreId ?? null;
}
