/**
 * 認証ガード(proxy.ts)の行き先を決める(ADR-083)。
 *
 * - ログイン画面:ログイン済みならホームへ(ログイン画面に取り残さない)。
 * - 誰でも見られる道(マニフェスト):そのまま。
 * - それ以外:未ログインなら、API は 401、画面はログイン画面へ。
 */

export type AuthGate = 'pass' | 'to-login' | 'to-home' | 'unauthorized';

const PUBLIC_PATHS = ['/manifest.webmanifest'];

export function isLoginPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/');
}

/** セッションを確かめずに通してよい道か(ログイン画面は、ログイン済みかを見るため含めない)。 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export function authGate(pathname: string, signedIn: boolean): AuthGate {
  if (isPublicPath(pathname)) return 'pass';
  if (isLoginPath(pathname)) return signedIn ? 'to-home' : 'pass';
  if (signedIn) return 'pass';
  return pathname.startsWith('/api/') ? 'unauthorized' : 'to-login';
}
