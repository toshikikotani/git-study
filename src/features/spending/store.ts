/**
 * 家計簿(/spending)のデータアクセス(本人発案:「普通の家計簿」への作り直し)。
 *
 * 元は「ちりつも」(小口支出の山)しか無く、収支の全体像・ジャンル別の内訳・
 * 今月の明細・予測が無かった。判断(集計)は既存の純粋関数
 * (domain/spending.ts・domain/accumulation.ts・domain/budget.ts)に任せ、
 * ここでは「DB から何を読むか」だけを担う。ジャンル(genres)に統廃合の概念は
 * 無い(categories.merged_into_id の廃止、ADR-057)ため、旧来の統廃合解決は
 * 不要になった。月次のスナップショットは保存しない(features/reports/store.ts
 * と同じ考え方。毎回 transactions を集計し直す)。
 */

import { compareToPreviousMonthPace, type AccumulationTransaction } from '@/domain/accumulation';
import { isCountable, type BudgetTransaction } from '@/domain/budget';
import {
  projectedMonthTotalYen,
  summarizeMonthlyIncomeExpense,
  type SpendingTransaction,
} from '@/domain/spending';
import { resolveItemGenres } from '@/features/genre/item-genres';
import type { PaymentMethod } from '@/features/import/adapters';
import { addMonths, daysBetween, monthStartJst, nthDayOfMonth, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { buildGenreBreakdown } from './breakdown';
import type {
  GenreBreakdownRow,
  LedgerTransaction,
  MonthlyLedgerView,
  MonthTotals,
} from './ledger-types';

export type {
  GenreBreakdownRow,
  LedgerTransaction,
  MonthlyForecast,
  MonthlyLedgerView,
  MonthlyPace,
} from './ledger-types';

export class SpendingStoreError extends AppError {}

export async function loadMonthlyLedger(now: Date = new Date()): Promise<MonthlyLedgerView> {
  const today = todayJst(now);
  const thisMonthStart = monthStartJst(0, now);
  const nextMonthStart = monthStartJst(1, now);
  // 先月同日比(domain/accumulation.ts の compareToPreviousMonthPace)のため、
  // 先月の月初まで遡って読む。
  const rangeStart = nthDayOfMonth(addMonths(today, -1), 1);

  const supabase = await createClient();

  const { data: genres, error: genresError } = await supabase
    .from('genres')
    .select('id, name, budget_yen')
    .order('sort_order', { ascending: true });
  if (genresError) {
    throw new SpendingStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
  }

  const { data: rows, error: txError } = await supabase
    .from('transactions')
    .select(
      'id, occurred_on, description, merchant_name, amount_yen, genre_id, is_transfer, review_status, account_id, payment_method',
    )
    .gte('occurred_on', rangeStart)
    .lte('occurred_on', today)
    .order('occurred_on', { ascending: false });
  if (txError) throw new SpendingStoreError(`明細を取得できませんでした: ${txError.message}`);

  const itemGenreByTransactionId = await resolveItemGenres(rows);

  const nameById = new Map(genres.map((g) => [g.id, g.name]));

  const mapped: (BudgetTransaction & {
    id: string;
    occurredOn: string;
    label: string;
    accountId: string;
    paymentMethod: PaymentMethod;
  })[] = rows.map((row) => ({
    id: row.id,
    categoryId: row.genre_id ?? itemGenreByTransactionId.get(row.id) ?? null,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
    label: row.merchant_name ?? row.description,
    accountId: row.account_id,
    paymentMethod: row.payment_method,
  }));

  const thisMonth = mapped.filter((tx) => tx.occurredOn >= thisMonthStart);
  const monthKey = thisMonthStart.slice(0, 7);

  const spendingTx: SpendingTransaction[] = mapped;
  const [incomeExpense] = summarizeMonthlyIncomeExpense(spendingTx, [monthKey]);
  const genreBreakdown = buildGenreBreakdown(genres, thisMonth, monthKey);

  const countableThisMonth = thisMonth.filter((tx) => isCountable(tx));
  const transactions: LedgerTransaction[] = countableThisMonth.map((tx) => ({
    id: tx.id,
    occurredOn: tx.occurredOn,
    label: tx.label,
    genreId: tx.categoryId,
    genreName: tx.categoryId === null ? null : (nameById.get(tx.categoryId) ?? null),
    amountYen: tx.amountYen,
    accountId: tx.accountId,
    paymentMethod: tx.paymentMethod,
  }));

  const elapsedDays = daysBetween(thisMonthStart, today) + 1;
  const totalDaysInMonth = daysBetween(thisMonthStart, nextMonthStart);
  const budgetedGenres = genres.filter((g) => g.budget_yen !== null);
  const totalBudgetYen =
    budgetedGenres.length === 0
      ? null
      : budgetedGenres.reduce((acc, g) => acc + (g.budget_yen ?? 0), 0);

  const accumulationTx: AccumulationTransaction[] = mapped;

  return {
    period: { from: thisMonthStart, to: today },
    totalSpentYen: incomeExpense!.expenseYen,
    totalIncomeYen: incomeExpense!.incomeYen,
    genreBreakdown,
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
 * カレンダー(家計簿トップ)で移動した月の、明細とジャンル別の内訳。
 * 明細は loadMonthlyLedger と同じ見え方(収支の対象になるものだけ・品目から決めた
 * 代表ジャンル込み・収入も含む)で新しい日付が先頭。内訳は今月と同じ
 * buildGenreBreakdown で組み立てるため、過去・未来の月も今月と同じ見た目になる。
 */
export async function loadCalendarMonth(monthStart: string): Promise<{
  transactions: LedgerTransaction[];
  genreBreakdown: GenreBreakdownRow[];
  totals: MonthTotals;
}> {
  const supabase = await createClient();
  const nextMonthStart = addMonths(monthStart, 1);

  const [{ data: genres, error: genresError }, { data: rows, error: txError }] = await Promise.all([
    supabase.from('genres').select('id, name, budget_yen').order('sort_order'),
    supabase
      .from('transactions')
      .select(
        'id, occurred_on, description, merchant_name, amount_yen, genre_id, is_transfer, review_status, account_id, payment_method',
      )
      .gte('occurred_on', monthStart)
      .lt('occurred_on', nextMonthStart)
      .order('occurred_on', { ascending: false }),
  ]);
  if (genresError) {
    throw new SpendingStoreError(`ジャンルを取得できませんでした: ${genresError.message}`);
  }
  if (txError) throw new SpendingStoreError(`明細を取得できませんでした: ${txError.message}`);

  const nameById = new Map(genres.map((g) => [g.id, g.name]));
  const inherited = await resolveItemGenres(rows);

  const mapped = rows.map((row) => ({
    id: row.id,
    categoryId: row.genre_id ?? inherited.get(row.id) ?? null,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    occurredOn: row.occurred_on,
    label: row.merchant_name ?? row.description,
    accountId: row.account_id,
    paymentMethod: row.payment_method,
  }));

  const transactions: LedgerTransaction[] = mapped
    .filter((tx) => isCountable(tx))
    .map((tx) => ({
      id: tx.id,
      occurredOn: tx.occurredOn,
      label: tx.label,
      genreId: tx.categoryId,
      genreName: tx.categoryId === null ? null : (nameById.get(tx.categoryId) ?? null),
      amountYen: tx.amountYen,
      accountId: tx.accountId,
      paymentMethod: tx.paymentMethod,
    }));

  const monthKey = monthStart.slice(0, 7);
  const [incomeExpense] = summarizeMonthlyIncomeExpense(mapped, [monthKey]);

  return {
    transactions,
    genreBreakdown: buildGenreBreakdown(genres, mapped, monthKey),
    totals: { spentYen: incomeExpense!.expenseYen, incomeYen: incomeExpense!.incomeYen },
  };
}
