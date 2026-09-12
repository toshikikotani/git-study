/**
 * `/reports` のデータアクセス(P6-2)。
 *
 * 月次のスナップショットを保存する仕組みは無い(TASKS.md 参照)ため、
 * 直近6ヶ月分の transactions を毎回集計する。判定(何を支出として数えるか)は
 * domain/spending.ts の summarizeMonthlySpendByCategory() が正。
 */

import { summarizeMonthlySpendByCategory, type SpendingTransaction } from '@/domain/spending';
import { monthStartJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export class ReportStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportStoreError';
  }
}

const MONTHS_BACK = 6;

export type CategorySpendingTrend = {
  /** 古い→新しいの順、'YYYY-MM' が6つ。 */
  monthKeys: readonly string[];
  /** 期間中に一度でも支出があったカテゴリのみ(全月0円の枠は並べても情報が無い)。 */
  categories: readonly { id: string; name: string }[];
  rows: readonly { monthKey: string; categoryId: string; categoryName: string; spentYen: number }[];
};

export async function loadCategorySpendingTrend(
  now: Date = new Date(),
): Promise<CategorySpendingTrend> {
  const monthKeys = Array.from({ length: MONTHS_BACK }, (_, i) =>
    monthStartJst(-(MONTHS_BACK - 1) + i, now).slice(0, 7),
  );
  const rangeStart = monthStartJst(-(MONTHS_BACK - 1), now);
  const rangeEnd = monthStartJst(1, now);

  const supabase = await createClient();
  const [{ data: categories, error: categoriesError }, { data: rows, error: rowsError }] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('transactions')
        .select('category_id, amount_yen, is_transfer, review_status, occurred_on')
        .gte('occurred_on', rangeStart)
        .lt('occurred_on', rangeEnd),
    ]);
  if (categoriesError) {
    throw new ReportStoreError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  if (rowsError) throw new ReportStoreError(`明細を取得できませんでした: ${rowsError.message}`);

  const transactions: SpendingTransaction[] = rows.map((row) => ({
    categoryId: row.category_id,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
  }));

  const allRows = summarizeMonthlySpendByCategory(categories, transactions, monthKeys);

  const totalByCategory = new Map<string, number>();
  for (const row of allRows) {
    totalByCategory.set(row.categoryId, (totalByCategory.get(row.categoryId) ?? 0) + row.spentYen);
  }
  const activeCategoryIds = new Set(
    [...totalByCategory.entries()].filter(([, total]) => total > 0).map(([id]) => id),
  );

  return {
    monthKeys,
    categories: categories
      .filter((c) => activeCategoryIds.has(c.id))
      .sort((a, b) => (totalByCategory.get(b.id) ?? 0) - (totalByCategory.get(a.id) ?? 0)),
    rows: allRows.filter((row) => activeCategoryIds.has(row.categoryId)),
  };
}
