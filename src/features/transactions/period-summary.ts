/**
 * 給料日〜給料日の期間ビュー(FR-17, M6-3)のデータアクセス。
 *
 * 保存は暦月のまま(ADR-015)。`paydayCycleFor()` で表示用の期間へ変換し、
 * その期間の明細だけを読んで口座別・カテゴリ別に集計する。
 */

import {
  sumByAccount,
  sumByCategory,
  totalSpending,
  type PeriodTransaction,
} from '@/domain/payday-period';
import { getAppSettings } from '@/features/settings/store';
import { paydayCycleFor, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export type AccountSpending = {
  accountId: string;
  accountName: string;
  spentYen: number;
};

export type CategorySpending = {
  categoryId: string | null;
  /** 未分類(categoryId: null)なら null。画面側で「未分類」等のラベルを当てる。 */
  categoryName: string | null;
  spentYen: number;
};

export type PaydayPeriodSummary = {
  startOn: DateOnly;
  endOn: DateOnly;
  totalSpentYen: number;
  /** 使用金額の多い順。登録済みの口座は 0 円でも含む(まだ使っていないことも情報)。 */
  byAccount: AccountSpending[];
  /** 使用金額の多い順。使用額が無いカテゴリは含めない。 */
  byCategory: CategorySpending[];
};

export class PeriodSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodSummaryError';
  }
}

export async function loadPaydayPeriodSummary(
  now: Date = new Date(),
): Promise<PaydayPeriodSummary> {
  const settings = await getAppSettings();
  const today = todayJst(now);
  const { startOn, endOn } = paydayCycleFor(today, settings.payday);

  const supabase = await createClient();
  const [
    { data: rows, error: rowsError },
    { data: accounts, error: accountsError },
    { data: categories, error: categoriesError },
  ] = await Promise.all([
    supabase
      .from('transactions')
      .select('account_id, category_id, amount_yen, is_transfer, review_status')
      .gte('occurred_on', startOn)
      .lte('occurred_on', endOn),
    supabase.from('accounts').select('id, name'),
    supabase.from('categories').select('id, name'),
  ]);
  if (rowsError) throw new PeriodSummaryError(`明細を取得できませんでした: ${rowsError.message}`);
  if (accountsError) {
    throw new PeriodSummaryError(`口座を取得できませんでした: ${accountsError.message}`);
  }
  if (categoriesError) {
    throw new PeriodSummaryError(`カテゴリを取得できませんでした: ${categoriesError.message}`);
  }

  const transactions: PeriodTransaction[] = rows.map((row) => ({
    accountId: row.account_id,
    categoryId: row.category_id,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
  }));

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const spentByAccount = sumByAccount(transactions);
  const byAccount: AccountSpending[] = accounts
    .map((account) => ({
      accountId: account.id,
      accountName: account.name,
      spentYen: spentByAccount.get(account.id) ?? 0,
    }))
    .sort((a, b) => b.spentYen - a.spentYen || a.accountName.localeCompare(b.accountName));

  const spentByCategory = sumByCategory(transactions);
  const byCategory: CategorySpending[] = [...spentByCategory.entries()]
    .map(([categoryId, spentYen]) => ({
      categoryId,
      categoryName: categoryId === null ? null : (categoryNameById.get(categoryId) ?? null),
      spentYen,
    }))
    .sort((a, b) => b.spentYen - a.spentYen);

  return {
    startOn,
    endOn,
    totalSpentYen: totalSpending(transactions),
    byAccount,
    byCategory,
  };
}
