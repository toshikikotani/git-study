import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isEveningCheckDue } from '@/domain/line-message';
import { checkMessage } from '@/features/line/conversation';
import { listTodayCheck } from '@/features/today-check/store';
import { hourJst, todayJst } from '@/lib/date';
import { getAppBaseUrl, getCronSecret, getLineEnv } from '@/lib/env';
import { pushLineMessages } from '@/lib/line';
import { createAdminClient } from '@/lib/supabase/admin';
import { findOwner } from '@/lib/supabase/owner';

/**
 * 夜の答え合わせ(v4-2「LINEで完結」、ADR-130)。毎時 GitHub Actions から呼ぶ。設定の時刻(日本時間、
 * 既定 21:00)になったら、今日の片づけるもの(今日の答え合わせと同じ対象)を LINE へ送る。0件の日・
 * オフの日・もう送った日は送らない。ボタンは「まとめて合ってる」と「1件ずつ見る」(アプリの答え合わせ)。
 *
 * 朝配信と同じく本人のセッションが無い経路なので、管理クライアント + 明示的な user_id で読む。
 * 送ったことは job_runs に残し、同じ日に二度送らない。
 */

export const runtime = 'nodejs';

const JOB_NAME = 'evening_check';

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${getCronSecret()}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}

/** 日本時間の今日の 0:00(UTC の ISO 文字列)。 */
function jstMidnightIso(today: string): string {
  return new Date(`${today}T00:00:00+09:00`).toISOString();
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '認証情報が正しくありません' }, { status: 401 });
  }
  const line = getLineEnv();
  if (!line) {
    return NextResponse.json({
      skipped: true,
      reason: 'LINE が未設定です(LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID)',
    });
  }

  const admin = createAdminClient();
  const { user, error: usersError } = await findOwner(admin);
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });
  if (!user) return NextResponse.json({ skipped: true, reason: 'ユーザーが存在しません' });

  const now = new Date();
  const today = todayJst(now);
  const [{ data: settings }, { data: sent }] = await Promise.all([
    admin.from('app_settings').select('*').eq('user_id', user.id).maybeSingle(),
    admin
      .from('job_runs')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_name', JOB_NAME)
      .eq('status', 'succeeded')
      .gte('started_at', jstMidnightIso(today))
      .limit(1),
  ]);
  const row = (settings ?? {}) as { evening_check_enabled?: unknown; evening_check_at?: unknown };
  const due = isEveningCheckDue({
    enabled: row.evening_check_enabled !== false,
    at: typeof row.evening_check_at === 'string' ? row.evening_check_at : '21:00',
    hourJst: hourJst(now),
    sentToday: (sent ?? []).length > 0,
  });
  if (!due) return NextResponse.json({ skipped: true, reason: '送る時間ではありません' });

  const startedAt = Date.now();
  try {
    const items = await listTodayCheck(admin, user.id, today);
    const message = checkMessage(items, getAppBaseUrl());
    if (message === null) return NextResponse.json({ skipped: true, reason: '今日は0件です' });
    await pushLineMessages(line.LINE_CHANNEL_ACCESS_TOKEN, line.LINE_USER_ID, [message]);
    await admin.from('job_runs').insert({
      user_id: user.id,
      job_name: JOB_NAME,
      status: 'succeeded',
      trigger_source: 'github_actions',
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      items_processed: items.length,
      detail: { count: items.length },
    });
    return NextResponse.json({ sent: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
