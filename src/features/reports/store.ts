/**
 * `/reports` のデータアクセス(P6-2)。
 *
 * 月次のスナップショットを保存する仕組みは無い(TASKS.md 参照)ため、
 * 直近6ヶ月分の transactions を毎回集計する。判定(何を支出として数えるか)は
 * domain/spending.ts の summarizeMonthlySpendByCategory() が正。
 */

import type { AccumulationTransaction } from '@/domain/accumulation';
import {
  rankMerchantsBySpend,
  summarizeMonthlyIncomeExpense,
  summarizeMonthlySpendByCategory,
  type MerchantSpend,
  type MonthlyIncomeExpense,
  type SpendingTransaction,
} from '@/domain/spending';
import { expandTransactionsWithSplits } from '@/domain/transaction-splits';
import { listSplitsForTransactionIds } from '@/features/transactions/splits-store';
import { monthStartJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

export class ReportStoreError extends AppError {}

const MONTHS_BACK = 6;
const INCOME_EXPENSE_MONTHS_BACK = 12;
const MERCHANT_RANKING_MONTHS_BACK = 3;
const MERCHANT_RANKING_LIMIT = 10;

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
        .select('id, category_id, amount_yen, is_transfer, review_status, occurred_on')
        .gte('occurred_on', rangeStart)
        .lt('occurred_on', rangeEnd),
    ]);
  if (categoriesError) {
    throw new ReportStoreError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  if (rowsError) throw new ReportStoreError(`明細を取得できませんでした: ${rowsError.message}`);

  // 分割(本人発案)がある明細は、集計の前に分割先のカテゴリ・金額へ展開する。
  const splitsByTransactionId = await listSplitsForTransactionIds(
    supabase,
    rows.map((r) => r.id),
  );
  const expandedRows = expandTransactionsWithSplits(
    rows.map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      amountYen: row.amount_yen,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
      occurredOn: row.occurred_on,
    })),
    splitsByTransactionId,
  );

  const transactions: SpendingTransaction[] = expandedRows.map((row) => ({
    categoryId: row.categoryId,
    amountYen: row.amountYen,
    isTransfer: row.isTransfer,
    reviewStatus: row.reviewStatus,
    occurredOn: row.occurredOn,
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

export type IncomeExpenseTrend = {
  /** 古い→新しいの順、'YYYY-MM' が12個。 */
  monthKeys: readonly string[];
  rows: readonly MonthlyIncomeExpense[];
};

/**
 * 直近12ヶ月の月次収入・支出(分析系拡充、本人発案)。
 *
 * カテゴリ別集計(loadCategorySpendingTrend)と違い、分割(transaction_splits)
 * を展開する必要が無い——分割はカテゴリの按分であって金額の合計は変わらない
 * ため、収支の全体像には影響しない。
 */
export async function loadIncomeExpenseTrend(now: Date = new Date()): Promise<IncomeExpenseTrend> {
  const monthKeys = Array.from({ length: INCOME_EXPENSE_MONTHS_BACK }, (_, i) =>
    monthStartJst(-(INCOME_EXPENSE_MONTHS_BACK - 1) + i, now).slice(0, 7),
  );
  const rangeStart = monthStartJst(-(INCOME_EXPENSE_MONTHS_BACK - 1), now);
  const rangeEnd = monthStartJst(1, now);

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('category_id, amount_yen, is_transfer, review_status, occurred_on')
    .gte('occurred_on', rangeStart)
    .lt('occurred_on', rangeEnd);
  if (error) throw new ReportStoreError(`明細を取得できませんでした: ${error.message}`);

  const transactions: SpendingTransaction[] = rows.map((row) => ({
    categoryId: row.category_id,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
  }));

  return { monthKeys, rows: summarizeMonthlyIncomeExpense(transactions, monthKeys) };
}

export type MerchantRanking = {
  /** 集計対象の月数(表示用)。 */
  monthsBack: number;
  merchants: readonly MerchantSpend[];
};

/**
 * 直近3ヶ月の店舗別支出ランキング、上位10件(分析系拡充、本人発案)。
 *
 * domain/accumulation.ts の summarizeSmallSpends と同じく分割を展開しない
 * (集計軸は店であり、按分しても店から見た支払いは1回・1金額のまま)。
 */
export async function loadMerchantSpendingRanking(
  now: Date = new Date(),
): Promise<MerchantRanking> {
  const rangeStart = monthStartJst(-(MERCHANT_RANKING_MONTHS_BACK - 1), now);
  const rangeEnd = monthStartJst(1, now);

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'category_id, amount_yen, is_transfer, review_status, occurred_on, merchant_name, description',
    )
    .gte('occurred_on', rangeStart)
    .lt('occurred_on', rangeEnd);
  if (error) throw new ReportStoreError(`明細を取得できませんでした: ${error.message}`);

  const transactions: AccumulationTransaction[] = rows.map((row) => ({
    categoryId: row.category_id,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
    label: row.merchant_name ?? row.description,
  }));

  return {
    monthsBack: MERCHANT_RANKING_MONTHS_BACK,
    merchants: rankMerchantsBySpend(transactions, MERCHANT_RANKING_LIMIT),
  };
}
