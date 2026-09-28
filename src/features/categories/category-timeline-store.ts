/**
 * `/reports/categories` のデータアクセス(カテゴリ別ページ、本人発案)。
 *
 * category-detail-store.ts(ホームの予算タイルの当月内訳)と違い、こちらは
 * 「1カテゴリの全期間」を対象にする——年→月→日のドリルダウンが本人の
 * 求める形(「自由に切り替えるように」)なので、何年分あるかを固定できない。
 * そのため月間隔での絞り込みはせず、そのカテゴリに属する取引を全期間
 * 読んでからクライアント側で年・月・日を切り替える。
 */

import {
  expandMergedCategoryIds,
  resolveCategoryRoot,
  type CategoryMergeNode,
} from '@/domain/category';
import { isCountable } from '@/domain/budget';
import {
  summarizeSpendByPeriod,
  type PeriodSpend,
  type SpendingTransaction,
} from '@/domain/spending';
import { expandTransactionsWithSplits } from '@/domain/transaction-splits';
import { listSplitsForTransactionIds } from '@/features/transactions/splits-store';
import type { DateOnly } from '@/lib/date';
import { monthStartJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

export class CategoryTimelineError extends AppError {}

const TREND_MONTHS_BACK = 12;

export type CategorySummary = {
  id: string;
  name: string;
  /** 直近12ヶ月の合計支出(正の数)。 */
  totalYen: number;
};

/**
 * カテゴリ一覧(直近12ヶ月の支出が多い順)。`/reports/categories` の入口。
 *
 * 支出が0円のカテゴリも並べる(loadCategorySpendingTrend と違い、こちらは
 * 「選んで詳細を見る」ための一覧であり、まだ使っていないカテゴリを隠す
 * 理由が無い)。
 */
export async function loadCategorySummaries(now: Date = new Date()): Promise<CategorySummary[]> {
  const rangeStart = monthStartJst(-(TREND_MONTHS_BACK - 1), now);
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
    throw new CategoryTimelineError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  if (rowsError)
    throw new CategoryTimelineError(`明細を取得できませんでした: ${rowsError.message}`);

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

  const totalByCategory = new Map<string, number>();
  for (const row of expandedRows) {
    if (row.categoryId === null || !isCountable(row) || row.amountYen >= 0) continue;
    totalByCategory.set(row.categoryId, (totalByCategory.get(row.categoryId) ?? 0) - row.amountYen);
  }

  return categories
    .map((c) => ({ id: c.id, name: c.name, totalYen: totalByCategory.get(c.id) ?? 0 }))
    .sort((a, b) => b.totalYen - a.totalYen);
}

export type CategoryTimelineTransaction = {
  id: string;
  occurredOn: DateOnly;
  label: string;
  /** 負の数(支出、ADR-008)。分割された明細は按分後の額。 */
  amountYen: number;
};

export type CategoryTimeline = {
  categoryId: string;
  categoryName: string;
  /** 古い→新しいの順、'YYYY-MM' が12個。上部の月次推移グラフ用。 */
  monthKeys: readonly string[];
  monthly: readonly PeriodSpend[];
  /**
   * 集計対象(isCountable)の全期間の支出明細、新しい順。年→月→日の
   * ドリルダウンはクライアント側でこの配列から組み立てる(新しいクエリを
   * 追加しない)。
   */
  transactions: readonly CategoryTimelineTransaction[];
};

/**
 * 1カテゴリの全期間の内訳を返す。カテゴリが存在しない・本人のものでない
 * 場合は null(RLS が他人の行を返さないため、両者は同じ結果になる)。
 *
 * ── 分割・統廃合の扱い ──────────────────────────────────────
 * loadCategorySpendingTrend()(/reports の6ヶ月グラフ)と同じ考え方:
 * 分割(transaction_splits)がある明細は按分先のカテゴリへ展開してから
 * 絞り込み、統廃合(merged_into_id)されたカテゴリの明細も
 * expandMergedCategoryIds() で吸収する。取引を先に category_id で絞り込むと
 * 「親の category_id は別カテゴリだが、分割の一部がこのカテゴリ」という
 * ケースを取りこぼすため、まず全期間を取得してから展開・絞り込みの順にする。
 */
export async function loadCategoryTimeline(
  categoryId: string,
  now: Date = new Date(),
): Promise<CategoryTimeline | null> {
  const supabase = await createClient();

  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('id, name')
    .eq('id', categoryId)
    .maybeSingle();
  if (categoryError) {
    throw new CategoryTimelineError(`カテゴリを取得できませんでした: ${categoryError.message}`);
  }
  if (!category) return null;

  const [{ data: mergeRows, error: mergeError }, { data: rows, error: txError }] =
    await Promise.all([
      supabase.from('categories').select('id, merged_into_id'),
      supabase
        .from('transactions')
        .select(
          'id, occurred_on, description, merchant_name, amount_yen, is_transfer, review_status, category_id',
        ),
    ]);
  if (mergeError) {
    throw new CategoryTimelineError(`カテゴリを取得できませんでした: ${mergeError.message}`);
  }
  if (txError) throw new CategoryTimelineError(`明細を取得できませんでした: ${txError.message}`);

  const mergeNodes: CategoryMergeNode[] = mergeRows.map((row) => ({
    id: row.id,
    mergedIntoId: row.merged_into_id,
  }));
  const expandedIds = new Set(expandMergedCategoryIds(mergeNodes, [categoryId]));

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
      label: row.merchant_name ?? row.description,
    })),
    splitsByTransactionId,
  );

  const categoryRows = expandedRows.filter(
    (row) =>
      row.categoryId !== null &&
      expandedIds.has(resolveCategoryRoot(row.categoryId, mergeNodes)) &&
      isCountable(row) &&
      row.amountYen < 0,
  );

  const spendingTransactions: SpendingTransaction[] = categoryRows.map((row) => ({
    categoryId: row.categoryId,
    amountYen: row.amountYen,
    isTransfer: row.isTransfer,
    reviewStatus: row.reviewStatus,
    occurredOn: row.occurredOn,
  }));

  const monthKeys = Array.from({ length: TREND_MONTHS_BACK }, (_, i) =>
    monthStartJst(-(TREND_MONTHS_BACK - 1) + i, now).slice(0, 7),
  );

  const transactions = categoryRows
    .map((row) => ({
      id: row.id,
      occurredOn: row.occurredOn,
      label: row.label,
      amountYen: row.amountYen,
    }))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

  return {
    categoryId,
    categoryName: category.name,
    monthKeys,
    monthly: summarizeSpendByPeriod(spendingTransactions, monthKeys, 7),
    transactions,
  };
}
