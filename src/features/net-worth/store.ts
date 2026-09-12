/**
 * 資産推移(残債総額 + 投資評価額)の記録と読み出し(P6-3)。
 *
 * debts.current_balance_yen は現在値のみで履歴を持たないため、月末に
 * net_worth_snapshots へ1行ずつ記録し始める(TASKS.md P6-3。マイグレーションは
 * 20260912000100_net_worth_snapshots.sql / 20260912000200_net_worth_snapshots_rls.sql)。
 * 記録した月以降のデータしか残らないため、グラフは記録開始後から少しずつ
 * 伸びていく(投資評価額側の investment_snapshots のように過去に遡ることはできない)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isLastDayOfMonth } from '@/domain/alerts';
import { totalInvestmentValueAsOf, type InvestmentSnapshotPoint } from '@/domain/investment';
import { addDays, todayJst, type DateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class NetWorthStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetWorthStoreError';
  }
}

/**
 * 月末にだけ、当月分の資産スナップショットを記録する。月末以外は何もしない
 * (0 を返す)。(user_id, as_of) が一意のため、同じ月に複数回呼んでも
 * 上書きになるだけで行は増えない。
 *
 * net_worth_snapshots が本番へ未適用の間は、この呼び出しが失敗する
 * (呼び出し側で必ず catch すること。rescued_emails の T-25 と同じ扱い)。
 */
export async function recordNetWorthSnapshotAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const today = todayJst(now);
  if (!isLastDayOfMonth(today, addDays(today, 1))) return 0;

  const [{ data: debts, error: debtsError }, { data: snapshots, error: snapshotsError }] =
    await Promise.all([
      client
        .from('debts')
        .select('current_balance_yen')
        .eq('user_id', userId)
        .eq('status', 'active'),
      client
        .from('investment_snapshots')
        .select('account_id, product_name, as_of, market_value_yen')
        .eq('user_id', userId),
    ]);
  if (debtsError) throw new NetWorthStoreError(`負債を取得できませんでした: ${debtsError.message}`);
  if (snapshotsError) {
    throw new NetWorthStoreError(`投資残高を取得できませんでした: ${snapshotsError.message}`);
  }

  const debtBalanceYen = debts.reduce((sum, d) => sum + d.current_balance_yen, 0);

  const points: InvestmentSnapshotPoint[] = snapshots.map((s) => ({
    productKey: `${s.account_id ?? ''}:${s.product_name ?? ''}`,
    asOf: s.as_of,
    marketValueYen: s.market_value_yen,
  }));
  const investmentValueYen = totalInvestmentValueAsOf(points, today);

  const { error } = await client.from('net_worth_snapshots').upsert(
    {
      user_id: userId,
      as_of: today,
      debt_balance_yen: debtBalanceYen,
      investment_value_yen: investmentValueYen,
    },
    { onConflict: 'user_id,as_of' },
  );
  if (error)
    throw new NetWorthStoreError(`資産スナップショットを記録できませんでした: ${error.message}`);
  return 1;
}

export type NetWorthPoint = {
  asOf: DateOnly;
  debtBalanceYen: number;
  investmentValueYen: number;
};

/** 記録済みの資産推移を古い順に返す(/reports のグラフ用)。 */
export async function loadNetWorthTrend(): Promise<NetWorthPoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('as_of, debt_balance_yen, investment_value_yen')
    .order('as_of', { ascending: true });
  if (error) throw new NetWorthStoreError(`資産推移を取得できませんでした: ${error.message}`);

  return data.map((row) => ({
    asOf: row.as_of,
    debtBalanceYen: row.debt_balance_yen,
    investmentValueYen: row.investment_value_yen,
  }));
}
