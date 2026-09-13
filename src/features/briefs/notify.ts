/**
 * 朝配信(daily_briefs)の Discord・LINE 送信(M5-2、LINE は後日追加)。
 *
 * `features/alerts/notify.ts` と同じ役割分担 — 各サービスのクライアント
 * 自体は `lib/discord.ts`/`lib/line.ts`(業務判断を持たない)、配信内容を
 * 組み立てるところ(業務判断)はここが担う。設定されているチャネルのうち
 * 1つでも送信できれば delivered とする(NFR-06 と同じ考え方)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { postDiscordEmbed } from '@/lib/discord';
import { todayJst } from '@/lib/date';
import type { NotificationChannels } from '@/lib/env';
import { postLineMessage } from '@/lib/line';
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
 * 当日分の配信を Discord・LINE へ送る。設定されているチャネルのうち
 * 1つでも送信できれば delivered とする(NFR-06)。
 *
 * `daily_briefs.status` を送信済みかどうかの正とする(alerts の
 * status='pending'/'sent' と同型)。既に `delivered` なら何もしない
 * (同じ日に何度実行しても二重送信しない、M5-2 の DoD)。
 */
export async function deliverDailyBriefAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  channels: NotificationChannels,
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

  const attempts: Promise<void>[] = [];
  if (channels.discordWebhookUrl) {
    attempts.push(
      postDiscordEmbed(channels.discordWebhookUrl, {
        title: '今日の配信',
        description: brief.body_md ?? undefined,
        color: 0x5865f2,
      }),
    );
  }
  if (channels.line) {
    const text = brief.body_md ? `📋 今日の配信\n${brief.body_md}` : '📋 今日の配信';
    attempts.push(
      postLineMessage(channels.line.LINE_CHANNEL_ACCESS_TOKEN, channels.line.LINE_USER_ID, text),
    );
  }

  const results = await Promise.allSettled(attempts);
  const succeeded = results.some((r) => r.status === 'fulfilled');

  if (!succeeded) {
    const message = results
      .map((r) => (r.status === 'rejected' ? String(r.reason) : null))
      .filter((m): m is string => m !== null)
      .join('; ');
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
