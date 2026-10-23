import { fetchQuickEntryGenres } from '@/features/genre/store';
import type { MobileGenre } from '@/features/mobile/contract';
import { withMobileSession } from '@/lib/supabase/bearer-session';

/** iPhone アプリの「記録する」のカテゴリ(よく使う順、Web の記録するシートと同じ、ADR-132)。 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileSession(async () => {
  const genres = await fetchQuickEntryGenres().catch(() => null);
  if (genres === null) {
    return Response.json({ error: 'カテゴリを読めませんでした。' }, { status: 500 });
  }
  return Response.json(genres.map((g): MobileGenre => ({ id: g.id, name: g.name })));
});
