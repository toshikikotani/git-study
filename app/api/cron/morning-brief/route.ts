import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { recordJobFailureAlertAsAdmin } from '@/features/alerts/store';
import { deliverDailyBriefAsAdmin } from '@/features/briefs/notify';
import { generateDailyBriefAsAdmin } from '@/features/briefs/store';
import { getCronSecret, getOptionalDiscordWebhookUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * 朝配信ジョブ(毎朝07:00 JST、M5-2)。
 *
 * `keepalive`/`import-gmail`/`detect-alerts` と同じく本人のセッションが
 * 無い経路のため、`createAdminClient()` + 明示的な user_id で生成・送信を
 * 行う。
 *
 * 流れ:当日分を生成(`ux_briefs_user_date` があるため二重生成しない)→
 * Discord へ送信。`daily_briefs.status='delivered'` を送信済みの正とする
 * ため、Actions の遅延で同じ日に複数回走っても二重送信しない(DoD)。
 * Webhook 未設定(B-3 待ち)の間は生成だけ行い、送信はスキップする。
 *
 * 失敗時は kind='job_failure' で alerts に記録する(detect-alerts と同じ、
 * T-24)。この記録自体が失敗しても本来のエラー応答は変えない。
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
    const { briefId, created } = await generateDailyBriefAsAdmin(admin, user.id);

    const webhookUrl = getOptionalDiscordWebhookUrl();
    if (!webhookUrl) {
      return NextResponse.json({
        briefId,
        created,
        skippedSend: true,
        reason: 'DISCORD_WEBHOOK_URL が未設定です',
      });
    }

    const result = await deliverDailyBriefAsAdmin(admin, user.id, webhookUrl);
    return NextResponse.json({ briefId, created, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobFailureAlertAsAdmin(admin, user.id, 'morning-brief', message).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
