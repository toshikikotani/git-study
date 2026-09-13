/**
 * 定期支払い(サブスク)検知のデータアクセス(本人発案)。
 *
 * 判断(何が定期支払いか)は domain/subscriptions.ts の純粋関数に任せ、
 * ここでは「DB から何を読むか」「新規検知をどう alerts へ記録するか」だけを
 * 担う(features/alerts/store.ts と同じ分離)。新しいテーブルは持たない
 * (毎回 transactions を集計し直す。domain/spending.ts と同じ考え方)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { buildNewSubscriptionAlert } from '@/domain/alerts';
import { detectSubscriptions, type DetectedSubscription } from '@/domain/subscriptions';
import { recordAlertsAsAdmin } from '@/features/alerts/store';
import { addMonths, todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class SubscriptionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionStoreError';
  }
}

/** 検知の対象期間。これより古い明細は「もう続いていない」可能性が高いため見ない。 */
const LOOKBACK_MONTHS = 12;

/** `/transactions` の表示用(セッション版)。 */
export async function loadDetectedSubscriptions(
  now: Date = new Date(),
): Promise<DetectedSubscription[]> {
  const supabase = await createClient();
  const rangeStart = addMonths(todayJst(now), -LOOKBACK_MONTHS);

  const { data, error } = await supabase
    .from('transactions')
    .select('merchant_name, description, amount_yen, occurred_on, is_transfer, review_status')
    .gte('occurred_on', rangeStart);
  if (error) throw new SubscriptionStoreError(`明細を取得できませんでした: ${error.message}`);

  return detectSubscriptions(
    data.map((row) => ({
      merchantName: row.merchant_name,
      description: row.description,
      amountYen: row.amount_yen,
      occurredOn: row.occurred_on,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
    })),
  );
}

/**
 * 新しく検知した定期支払いだけを alerts へ記録する(cron 向け)。
 * dedup_key(店・金額の組み合わせ)が同じものは DB の一意制約により
 * 二度と積まれないため、呼び出し側は「検知できたものを毎回全部渡す」
 * だけでよい(P5-2/P6-1 と同じ「積むのは冪等」パターン)。
 */
export async function detectAndRecordNewSubscriptionAlertsAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const rangeStart = addMonths(todayJst(now), -LOOKBACK_MONTHS);

  const { data, error } = await client
    .from('transactions')
    .select('merchant_name, description, amount_yen, occurred_on, is_transfer, review_status')
    .eq('user_id', userId)
    .gte('occurred_on', rangeStart);
  if (error) throw new SubscriptionStoreError(`明細を取得できませんでした: ${error.message}`);

  const subscriptions = detectSubscriptions(
    data.map((row) => ({
      merchantName: row.merchant_name,
      description: row.description,
      amountYen: row.amount_yen,
      occurredOn: row.occurred_on,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
    })),
  );

  return recordAlertsAsAdmin(client, userId, subscriptions.map(buildNewSubscriptionAlert));
}
