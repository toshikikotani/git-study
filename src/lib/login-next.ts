/**
 * ログインのあと戻ってよい場所(proxy.ts とログイン画面が使う)。知らない所・外のサイトへは飛ばさない。
 *   - /camera:ホーム画面のカメラのアイコンから来たとき(ADR-133)。
 *   - /oauth/authorize?…:AI のアプリとつなぐ同意画面から来たとき(ADR-143)。
 */
export function safeLoginNext(next: string | null): string | null {
  if (next === '/camera') return next;
  if (next !== null && next.startsWith('/oauth/authorize?') && !/[\\\s]/.test(next)) return next;
  return null;
}
