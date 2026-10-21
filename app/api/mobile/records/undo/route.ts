import { undoMobileRecords } from '@/features/mobile/records';
import { withMobileSession } from '@/lib/supabase/bearer-session';

/** iPhone アプリで、いま入れた記録を取り消す(アプリから入れた記録だけ、ADR-132)。 */
export const runtime = 'nodejs';

export const POST = withMobileSession(async (request, { userId }) => {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : [];
  const result = await undoMobileRecords(userId, ids);
  return Response.json(result, { status: result.error ? 400 : 200 });
});
