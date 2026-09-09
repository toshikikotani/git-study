import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getCronSecret } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Supabase 無料枠の自動停止を防ぐ死活ジョブ(NFR-05, M0-6)。
 *
 * pg_cron 側(supabase/migrations/20260908000900_cron.sql)と役割が重なる。
 * GitHub Actions がここを日次で叩き、pg_cron が(あるいはその逆が)止まっても
 * 書き込みは止まらないよう二重化してある(ADR-009, docs/architecture.md §3.4)。
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

  const startedAtMs = Date.now();
  const admin = createAdminClient();

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  // started_at は DB のデフォルト(insert 実行時刻)に任せない。INSERT 自体が
  // 遅延すると finished_at より後になり得るため、計測開始時刻を明示的に渡す。
  const startedAt = new Date(startedAtMs).toISOString();
  const finishedAt = new Date().toISOString();
  const rows = usersPage.users.map((user) => ({
    user_id: user.id,
    job_name: 'keepalive',
    status: 'succeeded' as const,
    trigger_source: 'github_actions' as const,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Date.now() - startedAtMs,
    items_processed: 1,
  }));

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const { error: insertError } = await admin.from('job_runs').insert(rows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: rows.length });
}
