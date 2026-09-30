/**
 * 固定費として確認した検知結果の永続化(N4)。detectSubscriptions() の
 * 候補そのものは毎回計算し直す(既存の subscriptions/store.ts と同じ
 * 都度計算の考え方)。ここで持つのは「本人がどのキーを固定費として
 * 確定したか」だけ。
 */

import { splitFixedVariable, type FixedVariableSplit } from '@/domain/subscriptions';
import { monthStartJst, todayJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { isMissingTableError } from '@/lib/supabase/errors';

export class FixedCostStoreError extends AppError {}

/** 確認済みの subscription_key 一覧。 */
export async function listConfirmedFixedCostKeys(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fixed_cost_confirmations')
    .select('subscription_key');
  if (error) {
    if (isMissingTableError(error)) return new Set();
    throw new FixedCostStoreError(`固定費の確認状況を取得できませんでした: ${error.message}`);
  }
  return new Set(data.map((row) => row.subscription_key));
}

export async function confirmFixedCost(subscriptionKey: string): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new FixedCostStoreError('ログイン状態を確認できませんでした');

  const { error } = await supabase
    .from('fixed_cost_confirmations')
    .upsert({ user_id: auth.user.id, subscription_key: subscriptionKey });
  if (error) throw new FixedCostStoreError(`固定費として登録できませんでした: ${error.message}`);
}

export async function unconfirmFixedCost(subscriptionKey: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('fixed_cost_confirmations')
    .delete()
    .eq('subscription_key', subscriptionKey);
  if (error) throw new FixedCostStoreError(`固定費の解除に失敗しました: ${error.message}`);
}

export type MonthTransactionForSplit = {
  merchantName: string | null;
  description: string;
  amountYen: number;
};

/** 今月の支出を固定費/変動費に分ける(N4)。 */
export async function loadFixedVariableSplit(
  now: Date = new Date(),
): Promise<FixedVariableSplit<MonthTransactionForSplit>> {
  const supabase = await createClient();
  const monthStart = monthStartJst(0, now);
  const today = todayJst(now);

  const { data, error } = await supabase
    .from('transactions')
    .select('merchant_name, description, amount_yen, is_transfer, review_status')
    .gte('occurred_on', monthStart)
    .lte('occurred_on', today)
    .lt('amount_yen', 0);
  if (error) throw new FixedCostStoreError(`明細を取得できませんでした: ${error.message}`);

  const confirmedKeys = await listConfirmedFixedCostKeys();
  const countable = data.filter((r) => !r.is_transfer && r.review_status !== 'ignored');

  return splitFixedVariable(
    countable.map((r) => ({
      merchantName: r.merchant_name,
      description: r.description,
      amountYen: r.amount_yen,
    })),
    confirmedKeys,
  );
}
