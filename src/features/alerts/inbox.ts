/**
 * お知らせ(アプリ内の通知の一覧、ADR-078)。alerts に積んだ通知を、本人のセッションで読む。
 * 表がまだ無い・読めないときは「お知らせなし」として扱い、画面全体は落とさない(ADR-033)。
 */

import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export type InboxItem = {
  id: string;
  title: string;
  body: string | null;
  severity: 'info' | 'warn' | 'critical';
  triggeredAt: string;
  read: boolean;
};

/** 一覧に出す件数と、さかのぼる日数。 */
const INBOX_LIMIT = 50;
const INBOX_DAYS = 60;

function since(now: Date): string {
  return new Date(now.getTime() - INBOX_DAYS * 86_400_000).toISOString();
}

export async function listInbox(now: Date = new Date()): Promise<InboxItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('alerts')
    .select('id, title, body, severity, triggered_at, acknowledged_at')
    .gte('triggered_at', since(now))
    .order('triggered_at', { ascending: false })
    .limit(INBOX_LIMIT);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`お知らせを読み込めませんでした: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity as InboxItem['severity'],
    triggeredAt: row.triggered_at,
    read: row.acknowledged_at !== null,
  }));
}

/** まだ見ていないお知らせの件数(ホームのお知らせボタンの印)。読めなければ 0。 */
export async function countUnread(now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .gte('triggered_at', since(now))
    .is('acknowledged_at', null);
  if (error) return 0;
  return count ?? 0;
}

/** 表示中のお知らせをすべて既読にする。 */
export async function acknowledgeAll(now: Date = new Date()): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('alerts')
    .update({ acknowledged_at: now.toISOString() })
    .is('acknowledged_at', null);
  if (error && !isMissingTableError(error)) {
    throw new Error(`既読にできませんでした: ${error.message}`);
  }
}
