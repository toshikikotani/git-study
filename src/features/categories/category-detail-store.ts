/**
 * ホームの予算タイル1枠分の当月内訳(本人発案:「生活費って押したら一覧
 * みたいなん」を見れるようにしたい)。
 *
 * ── ホームの数字と必ず一致させる ────────────────────────────
 * ここで出す使った額・残額は、features/home/summary.ts の buildHomeTiles()
 * が出す数字と同じでなければならない(タイルを押して開いた画面の合計が
 * タイル自体の数字と違うと、本人が数字を信じなくなる)。そのため集計ロジック
 * (domain/budget.ts の budgetStatusFor、統廃合カテゴリの扱い)は home/summary.ts
 * の listMonthTransactions() と同じ考え方をここでも使う。
 */

import { budgetStatusFor, type BudgetStatus } from '@/domain/budget';
import {
  expandMergedCategoryIds,
  resolveCategoryRoot,
  type CategoryMergeNode,
} from '@/domain/category';
import { monthStartJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export class CategoryDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryDetailError';
  }
}

export type CategoryTransactionDetail = {
  id: string;
  occurredOn: string;
  description: string;
  merchantName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
};

export type CategoryMonthDetail = {
  categoryId: string;
  categoryName: string;
  status: BudgetStatus;
  /** 集計対象(isCountable)の当月の明細のみ。日付の新しい順。 */
  transactions: readonly CategoryTransactionDetail[];
};

/**
 * 当月・1カテゴリ分の内訳を返す。カテゴリが存在しない・本人のものでない
 * 場合は null(RLS が他人の行を返さないため、両者は同じ結果になる)。
 */
export async function loadCategoryMonthDetail(
  categoryId: string,
  now: Date = new Date(),
): Promise<CategoryMonthDetail | null> {
  const supabase = await createClient();

  const { data: category, error: categoryError } = await supabase
    .from('categories')
    .select('id, code, name, default_monthly_budget_yen')
    .eq('id', categoryId)
    .maybeSingle();
  if (categoryError) {
    throw new CategoryDetailError(`カテゴリを取得できませんでした: ${categoryError.message}`);
  }
  if (!category) return null;

  const monthStart = monthStartJst(0, now);
  const [{ data: mergeRows, error: mergeError }, { data: budgetRow, error: budgetError }] =
    await Promise.all([
      supabase.from('categories').select('id, merged_into_id'),
      supabase
        .from('budgets')
        .select('amount_yen, carry_over_yen')
        .eq('category_id', categoryId)
        .eq('month', monthStart)
        .maybeSingle(),
    ]);
  if (mergeError) {
    throw new CategoryDetailError(`カテゴリを取得できませんでした: ${mergeError.message}`);
  }
  if (budgetError) {
    throw new CategoryDetailError(`予算を取得できませんでした: ${budgetError.message}`);
  }

  const mergeNodes: CategoryMergeNode[] = mergeRows.map((row) => ({
    id: row.id,
    mergedIntoId: row.merged_into_id,
  }));
  const expandedIds = expandMergedCategoryIds(mergeNodes, [categoryId]);

  const { data: rows, error: txError } = await supabase
    .from('transactions')
    .select(
      'id, occurred_on, description, merchant_name, amount_yen, is_transfer, review_status, category_id',
    )
    .in('category_id', expandedIds)
    .gte('occurred_on', monthStart)
    .lt('occurred_on', monthStartJst(1, now))
    .order('occurred_on', { ascending: false });
  if (txError) throw new CategoryDetailError(`明細を取得できませんでした: ${txError.message}`);

  const status = budgetStatusFor(
    {
      categoryId,
      code: category.code,
      budgetYen: budgetRow?.amount_yen ?? category.default_monthly_budget_yen,
      carryOverYen: budgetRow?.carry_over_yen ?? 0,
    },
    rows.map((row) => ({
      categoryId:
        row.category_id === null ? null : resolveCategoryRoot(row.category_id, mergeNodes),
      amountYen: row.amount_yen,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
    })),
  );

  // 表の合計が status.spentYen と必ず一致するよう、集計対象外(振替・ignored)
  // は表示からも外す(isCountable() の判定を budgetStatusFor 側と揃える)。
  const transactions = rows
    .filter((row) => !row.is_transfer && row.review_status !== 'ignored')
    .map((row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      description: row.description,
      merchantName: row.merchant_name,
      amountYen: row.amount_yen,
    }));

  return { categoryId, categoryName: category.name, status, transactions };
}
