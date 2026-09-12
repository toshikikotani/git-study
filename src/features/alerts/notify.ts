/**
 * 未送信の alerts を Discord へ送る(FR-24, M3-1)。
 *
 * 判断(色をどう決めるか)と送信(fetch)を分け、色決めだけを純粋関数にする。
 * 送信そのものは本物の Webhook が無いとテストできないため、統合検証は
 * 実際の Supabase プロジェクト + 実際の Webhook に対して行う。
 *
 * ── 失敗の扱い(NFR-06)────────────────────────────────────
 * 1件の送信失敗で残りを止めない。失敗した alert は status='failed' +
 * error_message に記録し、次のジョブ実行でも再送を試みる(status が
 * 'sent' になるまで pending のまま残るため、自然に再送される)。
 */

import type { AlertSeverity } from '@/domain/alerts';
import { postDiscordEmbed, type DiscordEmbed } from '@/lib/discord';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/** 深刻度ごとの色。Discord の Embed は10進数の色コードを取る。 */
const SEVERITY_COLOR: Record<AlertSeverity, number> = {
  info: 0x5865f2, // Discord Blurple
  warn: 0xfaa61a, // Amber
  critical: 0xed4245, // Red
};

export function buildEmbedForAlert(alert: {
  title: string;
  body: string | null;
  severity: AlertSeverity;
}): DiscordEmbed {
  return {
    title: alert.title,
    description: alert.body ?? undefined,
    color: SEVERITY_COLOR[alert.severity],
  };
}

export class NotifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotifyError';
  }
}

export type SendPendingAlertsResult = {
  sentCount: number;
  failedCount: number;
};

/**
 * status='pending' の alert を古い順に送る。1件ずつ送信・更新するため
 * 途中で失敗しても、それ以前に送れた分は 'sent' のまま残る。
 */
export async function sendPendingAlerts(
  client: SupabaseClient<Database>,
  userId: string,
  webhookUrl: string,
): Promise<SendPendingAlertsResult> {
  const { data: alerts, error } = await client
    .from('alerts')
    .select('id, title, body, severity')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('triggered_at', { ascending: true });
  if (error) throw new NotifyError(`通知を取得できませんでした: ${error.message}`);

  let sentCount = 0;
  let failedCount = 0;

  for (const alert of alerts) {
    try {
      await postDiscordEmbed(webhookUrl, buildEmbedForAlert(alert));
      await client
        .from('alerts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', alert.id);
      sentCount += 1;
    } catch (sendError) {
      await client
        .from('alerts')
        .update({
          status: 'failed',
          error_message: sendError instanceof Error ? sendError.message : String(sendError),
        })
        .eq('id', alert.id);
      failedCount += 1;
    }
  }

  return { sentCount, failedCount };
}
