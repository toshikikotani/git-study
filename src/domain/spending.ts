/**
 * カテゴリ別・月別の支出集計(P6-2、/reports の元データ)。
 *
 * 「使える残額」(domain/budget.ts)とは別の切り口:予算の有無に関係なく、
 * 全カテゴリの実際の支出額を月ごとに並べる。集計対象の定義
 * (振替・ignored を除く、収入を含めない)は domain/budget.ts の
 * isCountable() と揃える(同じ「支出」の定義を2箇所で別々に決めない)。
 */

import { isCountable, type BudgetTransaction } from '@/domain/budget';
import type { DateOnly } from '@/lib/date';

export type SpendingTransaction = BudgetTransaction & {
  occurredOn: DateOnly;
};

export type MonthlyCategorySpend = {
  monthKey: string;
  categoryId: string;
  categoryName: string;
  spentYen: number;
};

/**
 * 指定した月(monthKeys, 'YYYY-MM' の配列)× カテゴリの全組み合わせについて、
 * 支出額(正の数)を返す。取引が1件も無い月・カテゴリの組も 0 で含める
 * (budget.ts の summarizeBudgets と同じ考え方。行が消えると「未入力」なのか
 * 「本当に使っていない」のかが画面から区別できない)。
 *
 * 収入(amountYen > 0)は支出の集計に混ぜない。
 */
export function summarizeMonthlySpendByCategory(
  categories: readonly { id: string; name: string }[],
  transactions: readonly SpendingTransaction[],
  monthKeys: readonly string[],
): MonthlyCategorySpend[] {
  const spentByKey = new Map<string, number>();

  for (const tx of transactions) {
    if (!isCountable(tx) || tx.categoryId === null || tx.amountYen >= 0) continue;
    const monthKey = tx.occurredOn.slice(0, 7);
    const key = `${monthKey}:${tx.categoryId}`;
    spentByKey.set(key, (spentByKey.get(key) ?? 0) - tx.amountYen);
  }

  return monthKeys.flatMap((monthKey) =>
    categories.map((category) => ({
      monthKey,
      categoryId: category.id,
      categoryName: category.name,
      spentYen: spentByKey.get(`${monthKey}:${category.id}`) ?? 0,
    })),
  );
}
