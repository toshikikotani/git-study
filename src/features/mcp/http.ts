/**
 * OAuth・MCP の入口で使う小さな道具(ADR-143):リクエストの来た先(origin)と、外から呼ばれる入口の
 * CORS(ブラウザで動く MCP クライアントのため。cookie は使わないので * でよい)。
 */

/**
 * リクエストの来た先(https://ホスト)。Vercel ではホストごとに振り分けられるので、そのまま使う。
 * ホストの見出しが無ければ、リクエストの URL から決める。
 */
export function originOf(headers: Headers, url?: string): string {
  const header = headers.get('x-forwarded-host') ?? headers.get('host');
  if (header === null && url !== undefined) return new URL(url).origin;
  const host = (header ?? 'localhost').split(',')[0]!.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = (headers.get('x-forwarded-proto') ?? (local ? 'http' : 'https')).split(',')[0]!;
  return `${proto.trim()}://${host}`;
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
} as const;

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export function json(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...init.headers },
  });
}
