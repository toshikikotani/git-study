/**
 * `Authorization: Bearer <token>` のトークン(無ければ null)。iPhone アプリの入口(ADR-132)で、
 * proxy.ts の関所と route(lib/supabase/bearer-session.ts)の両方が使う。ほかに何も読み込まない
 * (関所を軽く保つ)。
 */
export function bearerTokenOf(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/);
  return match ? match[1]! : null;
}
