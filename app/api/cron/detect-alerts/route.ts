import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  detectAndRecordInactivityAlertAsAdmin,
  detectAndRecordPaymentDueAlertsAsAdmin,
  detectAndRecordRiskyTransactionAlertsAsAdmin,
} from '@/features/alerts/store';
import { sendPendingAlerts } from '@/features/alerts/notify';
import { getCronSecret, getOptionalDiscordWebhookUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * アラートジョブ(毎時、M3-3)。
 *
 * `keepalive`/`import-gmail` と同じく本人のセッションが無い経路のため、
 * `createAdminClient()` + 明示的な user_id で検知・送信を行う。
 *
 * 流れ:検知(FR-21 リボ等・FR-22 未取込・FR-23 返済日前日)→ alerts に記録
 * (重複は DB の一意制約が防ぐ)→ status='pending' の分を Discord へ送信。
 * Webhook 未設定(B-3 待ち)の間は検知だけ行い、送信はスキップする
 * (alerts には積み上がるので、Webhook 設定後にまとめて届く)。
 */

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${getCronSecret()}`;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(headerBuf, expectedBuf);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '認証情報が正しくありません' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users[0];
  if (!user) {
    return NextResponse.json({ skipped: true, reason: 'ユーザーが存在しません' });
  }

  try {
    const [paymentDueCount, inactivityCount, riskyCount] = await Promise.all([
      detectAndRecordPaymentDueAlertsAsAdmin(admin, user.id),
      detectAndRecordInactivityAlertAsAdmin(admin, user.id),
      detectAndRecordRiskyTransactionAlertsAsAdmin(admin, user.id),
    ]);
    const recordedCount = paymentDueCount + inactivityCount + riskyCount;

    const webhookUrl = getOptionalDiscordWebhookUrl();
    if (!webhookUrl) {
      return NextResponse.json({
        recordedCount,
        skippedSend: true,
        reason: 'DISCORD_WEBHOOK_URL が未設定です',
      });
    }

    const { sentCount, failedCount } = await sendPendingAlerts(admin, user.id, webhookUrl);
    return NextResponse.json({ recordedCount, sentCount, failedCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
