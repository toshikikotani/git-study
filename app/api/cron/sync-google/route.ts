import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { recordJobFailureAlertAsAdmin } from '@/features/alerts/store';
import { syncCalendarAsAdmin } from '@/features/google/calendar-store';
import { backupTransactionsToSheetAsAdmin } from '@/features/google/sheets-store';
import { getCronSecret, getGoogleEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Google連携ジョブ(本人発案、①③)。毎日1回このルートを叩くだけで:
 *  - カレンダー同期(給料日・サブスク更新日・完済予定日)は毎回実行、
 *  - スプレッドシートへの月次バックアップは月末だけ実際に書き込む
 * (P6-3 の net_worth_snapshots と同じ「既存の日次cronに相乗り」設計。
 *  月末判定自体は backupTransactionsToSheetAsAdmin() 側の isLastDayOfMonth()
 *  が持つため、このルートは日付を意識しない)。
 *
 * `detect-alerts`/`morning-brief` と同じく本人のセッションが無い経路のため、
 * `createAdminClient()` + 明示的な user_id を使う。
 *
 * Google 連携が未設定(本人が /settings/google での同意をまだ済ませていない)
 * 間はスキップするだけで、ジョブ自体は失敗させない(B-3 の Discord Webhook と
 * 同じ「あれば使う」設計)。
 *
 * 2つのジョブは互いに独立: 片方が失敗しても、もう片方は実行する
 * (それぞれ別の job 名で recordJobFailureAlertAsAdmin() に記録)。
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

  const google = getGoogleEnv();
  if (!google) {
    return NextResponse.json({
      skipped: true,
      reason: 'Google 連携が未設定です(GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN)',
    });
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

  const calendar = await syncCalendarAsAdmin(admin, user.id, google)
    .then((result) => ({ ok: true as const, result }))
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await recordJobFailureAlertAsAdmin(admin, user.id, 'sync-google-calendar', message).catch(
        () => {},
      );
      return { ok: false as const, error: message };
    });

  const sheets = await backupTransactionsToSheetAsAdmin(admin, user.id, google)
    .then((result) => ({ ok: true as const, result }))
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      await recordJobFailureAlertAsAdmin(admin, user.id, 'sync-google-sheets', message).catch(
        () => {},
      );
      return { ok: false as const, error: message };
    });

  const status = calendar.ok && sheets.ok ? 200 : 500;
  return NextResponse.json({ calendar, sheets }, { status });
}
