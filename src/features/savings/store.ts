/**
 * 貯金と貯金目標を読む(ADR-080)。計算は domain/savings.ts。
 *
 * 進行中の目標と、貯金を数え始めた日(いちばん早い目標の開始日)からの明細を読み、
 * 合計・今月の貯金・いつものペース・目標ごとの進み具合を返す。
 * ペースは直近の完了した月(最大3か月)から出すので、開始日より前の月も読む。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  allocateSavings,
  monthlySavings,
  recentMonthlySavings,
  savingsStartOf,
  savingsTotal,
  type SavingsGoalProgress,
  type SavingsTransaction,
} from '@/domain/savings';
import { listActiveGoalsAsAdmin, type Goal } from '@/features/goals/store';
import { addMonths, nthDayOfMonth, todayJst, type DateOnly } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { isMissingColumnError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

/** いつものペースに使う、完了した月の数。 */
const PACE_MONTHS = 3;

export type SavingsSummary = {
  /** 貯金を数え始めた日。進行中の目標が無ければ null(合計・目標は空)。 */
  startOn: DateOnly | null;
  /** 開始日からの貯金の合計(収入 − 支出。マイナスなら 0)。 */
  totalYen: number;
  /** 今月これまでの貯金(収入 − 支出。マイナスもある)。 */
  thisMonthYen: number;
  /** いつものペース(直近の完了した月の、1か月の貯金の平均)。月が無ければ null。 */
  paceYen: number | null;
  /** 期限の近い順。 */
  goals: SavingsGoalProgress<Goal>[];
};

export class SavingsStoreError extends AppError {}

export async function loadSavingsSummaryAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<SavingsSummary> {
  const today = todayJst(now);
  const goals = await listActiveGoalsAsAdmin(client, userId);
  const startOn = savingsStartOf(goals);
  const paceFrom = addMonths(nthDayOfMonth(today, 1), -PACE_MONTHS);
  const from = startOn !== null && startOn < paceFrom ? startOn : paceFrom;
  const transactions = await listSavingsTransactions(client, userId, from, today);

  const recent = monthlySavings(transactions, paceFrom, today);
  const paceYen = recentMonthlySavings(recent, today);
  const thisMonthYen = recent.at(-1)?.savedYen ?? 0;
  const totalYen =
    startOn === null ? 0 : savingsTotal(monthlySavings(transactions, startOn, today));

  return {
    startOn,
    totalYen,
    thisMonthYen,
    paceYen,
    goals: allocateSavings({ goals, totalYen, pace: paceYen, today }),
  };
}

export async function loadSavingsSummary(now: Date = new Date()): Promise<SavingsSummary> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new SavingsStoreError('ログイン状態を確認できませんでした');
  }
  return loadSavingsSummaryAsAdmin(supabase, auth.user.id, now);
}

type Row = {
  occurred_on: string;
  amount_yen: number;
  is_transfer: boolean;
  review_status: string;
  kind?: string | null;
};

const BASE_COLUMNS = 'occurred_on, amount_yen, is_transfer, review_status';

/** 1回に読む明細の数(PostgREST が1回に返す上限)。 */
const PAGE = 1000;

/** 期間の明細。kind 列が未適用の本番では、返金を区別せずに読む(ADR-033)。 */
async function listSavingsTransactions(
  client: SupabaseClient<Database>,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<SavingsTransaction[]> {
  const query = (columns: string, offset: number) =>
    client
      .from('transactions')
      .select(columns)
      .eq('user_id', userId)
      .gte('occurred_on', from)
      .lte('occurred_on', to)
      .order('occurred_on')
      .order('id')
      .range(offset, offset + PAGE - 1);

  let columns = `${BASE_COLUMNS}, kind`;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let result = await query(columns, offset);
    if (result.error && offset === 0 && isMissingColumnError(result.error)) {
      columns = BASE_COLUMNS;
      result = await query(columns, offset);
    }
    if (result.error) {
      throw new SavingsStoreError(`明細を取得できませんでした: ${result.error.message}`);
    }
    const page = result.data as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map((row) => ({
    occurredOn: row.occurred_on,
    amountYen: row.amount_yen,
    isTransfer: row.is_transfer,
    reviewStatus: row.review_status,
    kind: row.kind === 'special' || row.kind === 'refund' ? row.kind : 'normal',
  }));
}
