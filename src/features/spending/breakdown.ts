/**
 * 1か月分のジャンル別の内訳(家計簿の「ジャンル別の内訳」)を組み立てる。
 * DB にもネットワークにも触れない。今月(loadMonthlyLedger)とカレンダーで
 * 移動した過去・未来の月(loadCalendarMonth)が同じ結果になるよう、両方がここを使う。
 */

import { budgetTone, isCountable, type BudgetTransaction } from '@/domain/budget';
import { summarizeMonthlySpendByCategory, type SpendingTransaction } from '@/domain/spending';
import type { GenreBreakdownRow } from './ledger-types';

export const UNCATEGORIZED_LABEL = '未分類';

/**
 * 枠の警告色は domain/budget.ts の budgetTone() が担う判断(ホームの予算タイル
 * と同じ規約)。警告を出したくないジャンルは、予算を未設定のままにすればよい。
 */
function toneFor(genreId: string, budgetYen: number | null, spentYen: number) {
  return budgetTone({
    categoryId: genreId,
    budgetYen,
    carryOverYen: 0,
    spentYen,
    remainingYen: budgetYen === null ? null : budgetYen - spentYen,
    usageRatio: budgetYen !== null && budgetYen > 0 ? spentYen / budgetYen : null,
    transactionCount: 0,
  });
}

/**
 * monthKey('YYYY-MM')の内訳。金額の大きい順。予算は月次の値(genres.budget_yen)を
 * どの月にも同じように当てる。支出の無いジャンルは出さず、未分類の支出があれば
 * 「未分類」を1行足す。
 */
export function buildGenreBreakdown(
  genres: readonly { id: string; name: string; budget_yen: number | null }[],
  transactions: readonly SpendingTransaction[],
  monthKey: string,
): GenreBreakdownRow[] {
  const budgetById = new Map(genres.map((g) => [g.id, g.budget_yen]));
  const genreRows = summarizeMonthlySpendByCategory(
    genres.map((g) => ({ id: g.id, name: g.name })),
    transactions,
    [monthKey],
  );

  const uncategorizedYen = transactions
    .filter(
      (tx: BudgetTransaction & { occurredOn: string }) =>
        tx.occurredOn.startsWith(monthKey) &&
        isCountable(tx) &&
        tx.categoryId === null &&
        tx.amountYen < 0,
    )
    .reduce((acc, tx) => acc - tx.amountYen, 0);

  const breakdown: GenreBreakdownRow[] = genreRows
    .filter((row) => row.spentYen > 0)
    .map((row) => {
      const budgetYen = budgetById.get(row.categoryId) ?? null;
      return {
        genreId: row.categoryId,
        genreName: row.categoryName,
        spentYen: row.spentYen,
        budgetYen,
        tone: toneFor(row.categoryId, budgetYen, row.spentYen),
      };
    });
  if (uncategorizedYen > 0) {
    breakdown.push({
      genreId: null,
      genreName: UNCATEGORIZED_LABEL,
      spentYen: uncategorizedYen,
      budgetYen: null,
      tone: 'normal',
    });
  }
  return breakdown.sort((a, b) => b.spentYen - a.spentYen);
}
