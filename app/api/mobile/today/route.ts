import { loadMobileToday } from '@/features/mobile/today';
import { withMobileSession } from '@/lib/supabase/bearer-session';

/** iPhone アプリの「今日」(ADR-132)。Web の今日の画面と同じ計算。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileSession(async (_request, { userId }) => {
  try {
    return Response.json(await loadMobileToday(userId));
  } catch {
    return Response.json({ error: '今日の目安を読めませんでした。' }, { status: 500 });
  }
});
