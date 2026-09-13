/**
 * 重複候補(複数経路から入った同じ買い物)のデータアクセス(本人発案)。
 *
 * 判定は domain/duplicate-match.ts の純粋関数に任せ、ここでは
 * 「どの範囲を読むか」と「画面に出すための口座名の解決」だけを担う。
 * 新しいテーブルは持たない(除外の記録は既存の review_status='ignored')。
 */

import { findDuplicateCandidates, type MatchableTransaction } from '@/domain/duplicate-match';
import { addDays, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

import type { TransactionSource } from './types';

export class DuplicateStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateStoreError';
  }
}

/**
 * 遡る日数。取り込みは月次(CSV)と日次(メール・レシート)が混ざるため、
 * 月をまたいだ取り込みでも拾えるだけの幅を取る。
 */
const LOOKBACK_DAYS = 90;

export type DuplicateSideView = {
  id: string;
  occurredOn: DateOnly;
  label: string;
  /** 正の数(支出額)。 */
  amountYen: number;
  source: TransactionSource;
  accountName: string;
};

export type DuplicateCandidateView = {
  earlier: DuplicateSideView;
  later: DuplicateSideView;
  dayGap: number;
};

type Row = MatchableTransaction & {
  label: string;
  accountId: string;
};

export async function listDuplicateCandidates(
  now: Date = new Date(),
): Promise<DuplicateCandidateView[]> {
  const rangeStart = addDays(todayJst(now), -LOOKBACK_DAYS);

  const supabase = await createClient();
  const [{ data: rows, error }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase
      .from('transactions')
      .select(
        'id, account_id, occurred_on, amount_yen, merchant_name, description, source, is_transfer, review_status, category_id',
      )
      .gte('occurred_on', rangeStart),
    supabase.from('accounts').select('id, name'),
  ]);
  if (error) throw new DuplicateStoreError(`明細を取得できませんでした: ${error.message}`);
  if (accountsError) {
    throw new DuplicateStoreError(`口座を取得できませんでした: ${accountsError.message}`);
  }

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const transactions: Row[] = rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    occurredOn: row.occurred_on,
    amountYen: row.amount_yen,
    categoryId: row.category_id,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    source: row.source,
    label: row.merchant_name ?? row.description,
  }));

  return findDuplicateCandidates(transactions).map((candidate) => ({
    earlier: toSideView(candidate.earlier, accountNameById),
    later: toSideView(candidate.later, accountNameById),
    dayGap: candidate.dayGap,
  }));
}

function toSideView(row: Row, accountNameById: ReadonlyMap<string, string>): DuplicateSideView {
  return {
    id: row.id,
    occurredOn: row.occurredOn,
    label: row.label,
    amountYen: -row.amountYen,
    source: row.source,
    accountName: accountNameById.get(row.accountId) ?? '不明な口座',
  };
}
