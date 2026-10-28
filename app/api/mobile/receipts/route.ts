import { keepReceiptPhoto } from '@/features/mobile/records';
import { withMobileSession } from '@/lib/supabase/bearer-session';

/**
 * iPhone アプリで撮ったレシート(ADR-132)。読み取って「保存前」に残す。記録するのは、本人が確かめて
 * 「保存」を押したときだけ(ADR-141)。
 */
export const runtime = 'nodejs';
// 読み取り(AI)と分類・保存前に残すまでを同じ呼び出しで行うため。
export const maxDuration = 60;

const EMPTY = { ready: [], needsInput: false, checkPath: '/spending/review', warnings: [] };

/** 課金の AI を乱用から守る歯止め(プロセスが生きている間の1時間あたりの回数、import/receipt と同じ)。 */
const AI_CALL_LIMIT_PER_HOUR = 30;
let windowStartedAt = 0;
let callsInWindow = 0;
function takeSlot(now = Date.now()): boolean {
  if (now - windowStartedAt > 60 * 60 * 1000) {
    windowStartedAt = now;
    callsInWindow = 0;
  }
  if (callsInWindow >= AI_CALL_LIMIT_PER_HOUR) return false;
  callsInWindow += 1;
  return true;
}

export const POST = withMobileSession(async (request) => {
  const body = (await request.json().catch(() => null)) as { image?: unknown } | null;
  const image = typeof body?.image === 'string' ? body.image : '';
  if (image === '') {
    return Response.json({ ...EMPTY, error: '写真がありません。' }, { status: 400 });
  }
  if (!takeSlot()) {
    return Response.json(
      { ...EMPTY, error: '読み取りが混み合っています。少し時間をおいてください。' },
      { status: 429 },
    );
  }
  try {
    const result = await keepReceiptPhoto(image);
    return Response.json(result, { status: result.error ? 422 : 200 });
  } catch {
    return Response.json(
      { ...EMPTY, error: '読み取れませんでした。もう一度撮ってください。' },
      { status: 500 },
    );
  }
});
