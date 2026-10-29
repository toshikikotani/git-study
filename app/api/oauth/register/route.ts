import { json, preflight } from '@/features/mcp/http';
import { registerClient } from '@/features/mcp/oauth';

/**
 * クライアントの登録(RFC 7591 の動的な登録、ADR-143)。ChatGPT・Claude のアプリが最初に呼ぶ。
 * 登録しただけでは何も読めない(本人が同意画面で「許可する」を押すまで)。表には残さず、登録の中身を
 * 署名した client_id を返す。
 */
export const runtime = 'nodejs';

/** 乱用への歯止め(プロセスが生きている間の1分あたり)。 */
const PER_MINUTE = 30;
let windowStartedAt = 0;
let callsInWindow = 0;

export async function POST(request: Request): Promise<Response> {
  const t = Date.now();
  if (t - windowStartedAt > 60_000) {
    windowStartedAt = t;
    callsInWindow = 0;
  }
  if (++callsInWindow > PER_MINUTE) {
    return json({ error: 'temporarily_unavailable' }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== 'object') {
    return json(
      { error: 'invalid_client_metadata', error_description: 'JSON で送ってください' },
      { status: 400 },
    );
  }
  const result = registerClient(body);
  if (!result.ok) {
    return json({ error: result.error, error_description: result.description }, { status: 400 });
  }
  return json(result.body, { status: 201 });
}

export const OPTIONS = preflight;
