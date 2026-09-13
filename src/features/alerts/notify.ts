/**
 * 未送信の alerts を Discord・LINE へ送る(FR-24, M3-1。LINE は後日追加)。
 *
 * 判断(色/文言をどう決めるか)と送信(fetch)を分け、組み立てだけを純粋関数
 * にする。送信そのものは本物の Webhook/チャネルアクセストークンが無いと
 * テストできないため、統合検証は実際の Supabase プロジェクト + 実際の
 * Webhook・LINE ローカルスタブに対して行う。
 *
 * ── チャネルについて ────────────────────────────────────────
 * Discord・LINE の両方、どちらか一方だけ、のいずれでも動く(どちらも
 * 未設定なら呼び出し側がそもそも呼ばない、B-3 と同じ「あれば使う」設計)。
 * 設定されているチャネルのうち1つでも送信できれば、その alert は
 * status='sent' とする(NFR-06:1チャネルの失敗で残りを止めない)。
 * `alerts.channel` 列は現状どのチャネルへ送るかの判定には使っていない
 * (D-3 の初期スキーマにある列だが、Discord 単独の頃から未配線のまま。
 * 「送るなら設定済みの全チャネルへ」という単純な方針で足りている)。
 *
 * ── 失敗の扱い(NFR-06)────────────────────────────────────
 * 設定されている全チャネルで送信に失敗した alert だけ status='failed' +
 * error_message に記録し、次のジョブ実行でも再送を試みる(status が
 * 'sent' になるまで pending のまま残るため、自然に再送される)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AlertSeverity } from '@/domain/alerts';
import { postDiscordEmbed, type DiscordEmbed } from '@/lib/discord';
import type { NotificationChannels } from '@/lib/env';
import { postLineMessage } from '@/lib/line';
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

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: '🔵',
  warn: '🟠',
  critical: '🔴',
};

/**
 * LINE 用の本文組み立て。Discord の Embed と違い色を持たせられないため、
 * 絵文字で severity を表す(色だけに意味を持たせない、という既存の
 * アクセシビリティ方針とも整合する)。
 */
export function buildLineTextForAlert(alert: {
  title: string;
  body: string | null;
  severity: AlertSeverity;
}): string {
  const heading = `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`;
  return alert.body ? `${heading}\n${alert.body}` : heading;
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
  channels: NotificationChannels,
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
    const attempts: Promise<void>[] = [];
    if (channels.discordWebhookUrl) {
      attempts.push(postDiscordEmbed(channels.discordWebhookUrl, buildEmbedForAlert(alert)));
    }
    if (channels.line) {
      attempts.push(
        postLineMessage(
          channels.line.LINE_CHANNEL_ACCESS_TOKEN,
          channels.line.LINE_USER_ID,
          buildLineTextForAlert(alert),
        ),
      );
    }

    const results = await Promise.allSettled(attempts);
    const succeeded = results.some((r) => r.status === 'fulfilled');

    if (succeeded) {
      await client
        .from('alerts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', alert.id);
      sentCount += 1;
    } else {
      const errorMessage = results
        .map((r) => (r.status === 'rejected' ? String(r.reason) : null))
        .filter((m): m is string => m !== null)
        .join('; ');
      await client
        .from('alerts')
        .update({ status: 'failed', error_message: errorMessage })
        .eq('id', alert.id);
      failedCount += 1;
    }
  }

  return { sentCount, failedCount };
}
