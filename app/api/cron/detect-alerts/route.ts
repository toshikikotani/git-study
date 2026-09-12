import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  detectAndRecordInactivityAlertAsAdmin,
  detectAndRecordMonthlyRecapAlertAsAdmin,
  detectAndRecordPaymentDueAlertsAsAdmin,
  detectAndRecordRiskyTransactionAlertsAsAdmin,
  detectAndRecordWastefulBudgetAlertsAsAdmin,
  recordJobFailureAlertAsAdmin,
} from '@/features/alerts/store';
import { sendPendingAlerts } from '@/features/alerts/notify';
import { detectAndDeactivateMisfiringRulesAsAdmin } from '@/features/classification/store';
import { recordNetWorthSnapshotAsAdmin } from '@/features/net-worth/store';
import { getCronSecret, getOptionalDiscordWebhookUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * アラートジョブ(毎時、M3-3)。
 *
 * `keepalive`/`import-gmail` と同じく本人のセッションが無い経路のため、
 * `createAdminClient()` + 明示的な user_id で検知・送信を行う。
 *
 * 流れ:検知(FR-20 浪費70%・FR-21 リボ等・FR-22 未取込・FR-23 返済日前日・
 * P5-2 誤爆気味の学習ルールの無効化・P6-1 月末の月次振り返り)→ alerts に記録
 * (重複は DB の一意制約が防ぐ)→ status='pending' の分を Discord へ送信。
 * Webhook 未設定(B-3 待ち)の間は検知だけ行い、送信はスキップする(alerts
 * には積み上がるので、Webhook 設定後にまとめて届く)。
 *
 * ついでに月末だけ P6-3 の資産スナップショット(net_worth_snapshots)も記録する。
 * 既存の毎時ジョブに相乗りしているだけで、alerts の一部ではない
 * (recordedCount には含めない)。
 *
 * 失敗時は kind='job_failure' で alerts に記録する(T-24、M3-3 の DoD)。
 * この記録自体が失敗しても本来のエラー応答は変えない(catch で握り潰す)。
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
    const [paymentDueCount, inactivityCount, riskyCount, wastefulCount, misfireCount, recapCount] =
      await Promise.all([
        detectAndRecordPaymentDueAlertsAsAdmin(admin, user.id),
        detectAndRecordInactivityAlertAsAdmin(admin, user.id),
        detectAndRecordRiskyTransactionAlertsAsAdmin(admin, user.id),
        detectAndRecordWastefulBudgetAlertsAsAdmin(admin, user.id),
        detectAndDeactivateMisfiringRulesAsAdmin(admin, user.id),
        detectAndRecordMonthlyRecapAlertAsAdmin(admin, user.id),
      ]);
    const recordedCount =
      paymentDueCount + inactivityCount + riskyCount + wastefulCount + misfireCount + recapCount;

    // P6-3: net_worth_snapshots は本番マイグレーション未適用のため(T-26)、
    // 他の検知を止めないよう個別に catch する(rescued_emails の T-25 と同じ扱い)。
    await recordNetWorthSnapshotAsAdmin(admin, user.id).catch(() => undefined);

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
    const message = error instanceof Error ? error.message : String(error);
    await recordJobFailureAlertAsAdmin(admin, user.id, 'detect-alerts', message).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
