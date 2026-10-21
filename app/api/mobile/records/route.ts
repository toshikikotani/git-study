import type { MobileRecordInput } from '@/features/mobile/contract';
import { recordExpense } from '@/features/mobile/records';
import { withMobileSession } from '@/lib/supabase/bearer-session';

/** iPhone アプリの「記録する」(支出を1件、ADR-132)。 */
export const runtime = 'nodejs';

export const POST = withMobileSession(async (request, { userId }) => {
  const body = (await request.json().catch(() => null)) as Partial<MobileRecordInput> | null;
  if (body === null || typeof body.amountYen !== 'number') {
    return Response.json({ record: null, error: '金額を入れてください。' }, { status: 400 });
  }
  const input: MobileRecordInput = {
    amountYen: body.amountYen,
    genreId: typeof body.genreId === 'string' ? body.genreId : null,
    ...(typeof body.occurredOn === 'string' ? { occurredOn: body.occurredOn } : {}),
    ...(typeof body.label === 'string' ? { label: body.label } : {}),
  };
  const result = await recordExpense(userId, input);
  return Response.json(result, { status: result.error ? 400 : 200 });
});
