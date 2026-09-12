/**
 * 朝配信(daily_briefs)の Discord 送信(M5-2)。
 *
 * `features/alerts/notify.ts` と同じ役割分担 — Discord クライアント自体は
 * `lib/discord.ts`(業務判断を持たない)、配信内容から Embed を組み立てる
 * ところ(業務判断)はここが担う。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { postDiscordEmbed } from '@/lib/discord';
import { todayJst } from '@/lib/date';
import type { Database } from '@/lib/supabase/types';

export class BriefNotifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefNotifyError';
  }
}

export type DeliverDailyBriefResult =
  'delivered' | 'already_delivered' | 'failed' | 'not_generated';

/**
 * 当日分の配信を Discord へ送る。
 *
 * `daily_briefs.status` を送信済みかどうかの正とする(alerts の
 * status='pending'/'sent' と同型)。既に `delivered` なら何もしない
 * (同じ日に何度実行しても二重送信しない、M5-2 の DoD)。
 */
export async function deliverDailyBriefAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  webhookUrl: string,
  now: Date = new Date(),
): Promise<DeliverDailyBriefResult> {
  const { data: brief, error } = await client
    .from('daily_briefs')
    .select('id, status, body_md')
    .eq('user_id', userId)
    .eq('brief_on', todayJst(now))
    .maybeSingle();
  if (error) throw new BriefNotifyError(`配信を確認できませんでした: ${error.message}`);
  if (!brief) return 'not_generated';
  if (brief.status === 'delivered') return 'already_delivered';

  try {
    await postDiscordEmbed(webhookUrl, {
      title: '今日の配信',
      description: brief.body_md ?? undefined,
      color: 0x5865f2,
    });
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    const { error: updateError } = await client
      .from('daily_briefs')
      .update({ status: 'failed', error_message: message })
      .eq('id', brief.id);
    if (updateError) {
      throw new BriefNotifyError(`失敗の記録に失敗しました: ${updateError.message}`);
    }
    return 'failed';
  }

  const { error: updateError } = await client
    .from('daily_briefs')
    .update({
      status: 'delivered',
      delivered_at: new Date(now).toISOString(),
      error_message: null,
    })
    .eq('id', brief.id);
  if (updateError) {
    throw new BriefNotifyError(`配信済みの記録に失敗しました: ${updateError.message}`);
  }
  return 'delivered';
}
