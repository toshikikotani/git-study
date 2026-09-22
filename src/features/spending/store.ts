/**
 * 家計簿(/spending)のデータアクセス(本人発案:「普通の家計簿」への作り直し)。
 *
 * 元は「ちりつも」(小口支出の山)しか無く、収支の全体像・カテゴリ別の内訳・
 * 今月の明細・予測が無かった。判断(集計)は既存の純粋関数
 * (domain/spending.ts・domain/accumulation.ts・domain/budget.ts)に任せ、
 * ここでは「DB から何を読むか」と「カテゴリの統廃合(merged_into_id)の解決」
 * だけを担う。月次のスナップショットは保存しない(features/reports/store.ts
 * と同じ考え方。毎回 transactions を集計し直す)。
 */

import { compareToPreviousMonthPace, type AccumulationTransaction } from '@/domain/accumulation';
import { budgetTone, isCountable, type BudgetTransaction } from '@/domain/budget';
import { resolveCategoryRoot, type CategoryMergeNode } from '@/domain/category';
import { receiptItemsStatus } from '@/domain/receipt-items';
import {
  projectedMonthTotalYen,
  summarizeMonthlyIncomeExpense,
  summarizeMonthlySpendByCategory,
  type SpendingTransaction,
} from '@/domain/spending';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { addMonths, daysBetween, monthStartJst, nthDayOfMonth, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { CategoryBreakdownRow, LedgerTransaction, MonthlyLedgerView } from './ledger-types';

export type {
  CategoryBreakdownRow,
  LedgerTransaction,
  MonthlyForecast,
  MonthlyLedgerView,
  MonthlyPace,
} from './ledger-types';

export class SpendingStoreError extends AppError {}

const UNCATEGORIZED_LABEL = '未分類';

export async function loadMonthlyLedger(now: Date = new Date()): Promise<MonthlyLedgerView> {
  const today = todayJst(now);
  const thisMonthStart = monthStartJst(0, now);
  const nextMonthStart = monthStartJst(1, now);
  // 先月同日比(domain/accumulation.ts の compareToPreviousMonthPace)のため、
  // 先月の月初まで遡って読む。
  const rangeStart = nthDayOfMonth(addMonths(today, -1), 1);

  const supabase = await createClient();

  const [{ data: categories, error: categoriesError }, { data: mergeRows, error: mergeError }] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, code, name, default_monthly_budget_yen')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase.from('categories').select('id, merged_into_id'),
    ]);
  if (categoriesError) {
    throw new SpendingStoreError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }
  if (mergeError) {
    throw new SpendingStoreError(`カテゴリを取得できませんでした: ${mergeError.message}`);
  }

  const categoryIds = categories.map((c) => c.id);
  const { data: budgetRows, error: budgetError } =
    categoryIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('budgets')
          .select('category_id, amount_yen')
          .eq('month', thisMonthStart)
          .in('category_id', categoryIds);
  if (budgetError) {
    throw new SpendingStoreError(`予算を取得できませんでした: ${budgetError.message}`);
  }

  const { data: rows, error: txError } = await supabase
    .from('transactions')
    .select(
      'id, occurred_on, description, merchant_name, amount_yen, category_id, is_transfer, review_status',
    )
    .gte('occurred_on', rangeStart)
    .lte('occurred_on', today)
    .order('occurred_on', { ascending: false });
  if (txError) throw new SpendingStoreError(`明細を取得できませんでした: ${txError.message}`);

  const mergeNodes: CategoryMergeNode[] = mergeRows.map((row) => ({
    id: row.id,
    mergedIntoId: row.merged_into_id,
  }));
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const budgetOverrideById = new Map(budgetRows.map((b) => [b.category_id, b.amount_yen]));
  const budgetOf = (categoryId: string): number | null =>
    budgetOverrideById.get(categoryId) ??
    categories.find((c) => c.id === categoryId)?.default_monthly_budget_yen ??
    null;

  const mapped: (BudgetTransaction & { id: string; occurredOn: string; label: string })[] =
    rows.map((row) => ({
      id: row.id,
      categoryId:
        row.category_id === null ? null : resolveCategoryRoot(row.category_id, mergeNodes),
      amountYen: row.amount_yen,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
      occurredOn: row.occurred_on,
      label: row.merchant_name ?? row.description,
    }));

  const thisMonth = mapped.filter((tx) => tx.occurredOn >= thisMonthStart);
  const monthKey = thisMonthStart.slice(0, 7);

  const spendingTx: SpendingTransaction[] = mapped;
  const [incomeExpense] = summarizeMonthlyIncomeExpense(spendingTx, [monthKey]);
  const categoryRows = summarizeMonthlySpendByCategory(
    categories.map((c) => ({ id: c.id, name: c.name })),
    spendingTx,
    [monthKey],
  );

  const uncategorizedYen = thisMonth
    .filter((tx) => isCountable(tx) && tx.categoryId === null && tx.amountYen < 0)
    .reduce((acc, tx) => acc - tx.amountYen, 0);

  const categoryBreakdown: CategoryBreakdownRow[] = categoryRows
    .filter((row) => row.spentYen > 0)
    .map((row) => {
      const budgetYen = budgetOf(row.categoryId);
      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        spentYen: row.spentYen,
        budgetYen,
        tone: toneFor(row.categoryId, categories, budgetYen, row.spentYen),
      };
    });
  if (uncategorizedYen > 0) {
    categoryBreakdown.push({
      categoryId: null,
      categoryName: UNCATEGORIZED_LABEL,
      spentYen: uncategorizedYen,
      budgetYen: null,
      tone: 'normal',
    });
  }
  categoryBreakdown.sort((a, b) => b.spentYen - a.spentYen);

  const countableThisMonth = thisMonth.filter((tx) => isCountable(tx));
  // レシートの商品名(ADR-034)。「何に使ったか」を今月の一覧でも見せる。
  const itemsByTransactionId = await listReceiptItemsForTransactionIds(
    countableThisMonth.map((tx) => tx.id),
  );

  const transactions: LedgerTransaction[] = countableThisMonth.map((tx) => {
    const items = itemsByTransactionId.get(tx.id) ?? [];
    return {
      id: tx.id,
      occurredOn: tx.occurredOn,
      label: tx.label,
      categoryName: tx.categoryId === null ? null : (nameById.get(tx.categoryId) ?? null),
      amountYen: tx.amountYen,
      itemNames: items.map((item) => item.name),
      itemsStatus: receiptItemsStatus(items, tx.amountYen),
    };
  });

  const elapsedDays = daysBetween(thisMonthStart, today) + 1;
  const totalDaysInMonth = daysBetween(thisMonthStart, nextMonthStart);
  const budgetedCategoryIds = categories.filter((c) => budgetOf(c.id) !== null);
  const totalBudgetYen =
    budgetedCategoryIds.length === 0
      ? null
      : budgetedCategoryIds.reduce((acc, c) => acc + (budgetOf(c.id) ?? 0), 0);

  const accumulationTx: AccumulationTransaction[] = mapped;

  return {
    period: { from: thisMonthStart, to: today },
    totalSpentYen: incomeExpense!.expenseYen,
    totalIncomeYen: incomeExpense!.incomeYen,
    categoryBreakdown,
    transactions,
    forecast: {
      elapsedDays,
      totalDaysInMonth,
      projectedTotalYen: projectedMonthTotalYen(
        incomeExpense!.expenseYen,
        elapsedDays,
        totalDaysInMonth,
      ),
      totalBudgetYen,
    },
    pace: compareToPreviousMonthPace(accumulationTx, today),
  };
}

/**
 * 聖域カテゴリ(code === 'sanctuary')は警告色にしない(domain/budget.ts の
 * budgetTone() が担う判断。ホームの予算タイルと同じ規約、ADR は無いが
 * app/(app)/page.tsx の同名分岐を踏襲)。
 */
function toneFor(
  categoryId: string,
  categories: readonly { id: string; code: string }[],
  budgetYen: number | null,
  spentYen: number,
) {
  const code = categories.find((c) => c.id === categoryId)?.code;
  return budgetTone(
    {
      categoryId,
      code: code ?? '',
      budgetYen,
      carryOverYen: 0,
      spentYen,
      remainingYen: budgetYen === null ? null : budgetYen - spentYen,
      usageRatio: budgetYen !== null && budgetYen > 0 ? spentYen / budgetYen : null,
      transactionCount: 0,
    },
    code === 'sanctuary' ? 'sanctuary' : 'other',
  );
}
