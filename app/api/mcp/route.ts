import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { originOf } from '@/features/mcp/http';
import { isAccessToken, oauthUrls, verifyAccessToken } from '@/features/mcp/oauth';
import { createKakeiboMcpServer } from '@/features/mcp/server';
import { verifyMcpToken } from '@/features/mcp/tokens';
import { bearerTokenOf } from '@/lib/bearer-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAsOwner } from '@/lib/supabase/owner-session';

/**
 * 家計簿の MCP サーバーの入口(AI とつなぐ、ADR-142・143)。2通りの鍵で呼べる:
 *   - `Authorization: Bearer kkb_…`:設定 › AI とつなぐ で発行した個人用の鍵(Claude Code など)。
 *   - `Authorization: Bearer kka_…`:OAuth で本人が許可したアプリ(ChatGPT・Claude のアプリ)。
 * 鍵が無い・違うときの 401 には、認可サーバーの案内の場所(resource_metadata)を付ける。アプリはそれを
 * 見て、登録 → 本人のログインと同意 → トークン、と進む。
 *
 * ── 認証 ────────────────────────────────────────────────────
 * proxy.ts はこのパスを対象外にしている(MCP クライアントはセッション cookie を持たない。cron・
 * webhooks と同じく、route が自分で確かめる)。ここで最初に鍵を確かめ、合わなければ何も読まずに 401。
 * 鍵は本人(オーナー)の鍵だけで、道具は本人のセッション(runAsOwner、RLS のまま)の中で読む。
 *
 * ── 形 ──────────────────────────────────────────────────────
 * Streamable HTTP の、状態を持たない形(1回の POST に JSON で1回答える)。書く道具は、本人がチャットで
 * 許可したときに呼ばれる(ADR-144)。
 */

export const runtime = 'nodejs';
// 見通しの計算(予測)を道具の中で行うため。
export const maxDuration = 60;

/** 乱用への歯止め(プロセスが生きている間の1分あたりの回数)。 */
const CALLS_PER_MINUTE = 120;
let windowStartedAt = 0;
let callsInWindow = 0;
function takeSlot(now = Date.now()): boolean {
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    callsInWindow = 0;
  }
  if (callsInWindow >= CALLS_PER_MINUTE) return false;
  callsInWindow += 1;
  return true;
}

export async function POST(request: Request): Promise<Response> {
  const urls = oauthUrls(originOf(request.headers, request.url));
  const unauthorized = (invalid: boolean) =>
    Response.json(
      {
        error:
          '鍵が違うか、取り消されています。つなぎ直すか、設定 › AI とつなぐ で発行してください。',
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer realm="kakeibo", resource_metadata="${urls.resourceMetadata}"${invalid ? ', error="invalid_token"' : ''}`,
        },
      },
    );

  const token = bearerTokenOf(request);
  if (!token) return unauthorized(false);
  if (!takeSlot()) {
    return Response.json({ error: '呼び出しが多すぎます。少し待ってください。' }, { status: 429 });
  }

  const admin = createAdminClient();
  const owner = await (
    isAccessToken(token) ? verifyAccessToken(admin, token, urls.mcp) : verifyMcpToken(admin, token)
  ).catch(() => null);
  if (!owner) return unauthorized(true);

  const server = createKakeiboMcpServer({
    userId: owner.id,
    run: (fn) => runAsOwner(admin, owner, fn),
  });
  // sessionIdGenerator を渡さない = 状態を持たない形(セッションの id を出さない・確かめない)。
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => {});
  }
}

/** 状態を持たない形なので、通知の流れ(GET)・セッションの終わり(DELETE)は無い。 */
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

export const GET = notAllowed;
export const DELETE = notAllowed;
