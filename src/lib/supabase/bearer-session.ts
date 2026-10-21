/**
 * iPhone アプリからの呼び出しを、本人のセッションとして動かす(ADR-132)。
 *
 * アプリは Supabase にログインして受け取ったアクセストークンを `Authorization: Bearer …` で送る。
 * ここでそのトークンを Supabase に確かめ(本物か・期限内か)、本人のセッションのクライアント(RLS の
 * まま、本人の行だけ)を作って、その処理のあいだだけ `createClient()` が返すようにする
 * (session-override.ts)。Web の cookie のセッションには触らない。
 *
 *   - リフレッシュトークンは受け取らない(期限が近ければ 401 を返し、アプリが更新して送り直す)。
 *   - ここで作ったセッションは保存しない・使い回さない。ログアウト(signOut)は呼ばない
 *     (呼ぶとアプリのセッションまで無効になる)。
 *   - proxy.ts の関所も、同じトークンを確かめてから通す(二重に確かめる)。
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { bearerTokenOf } from '@/lib/bearer-token';
import { getPublicEnv } from '@/lib/env';
import { runWithSessionClient } from './session-override';
import type { Database } from './types';

/** 期限がこれより近いトークンは受け付けない(処理の途中で切れないように)。 */
const EXPIRY_MARGIN_SECONDS = 30;

/**
 * トークンの期限が切れている・近いか(中身を読むだけ。本物かどうかはここでは見ない)。
 * 読めないトークンも切れている扱い。
 */
export function isExpiringToken(token: string, nowSeconds = Date.now() / 1000): boolean {
  const payload = token.split('.')[1];
  if (!payload) return true;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof json.exp !== 'number' || json.exp - EXPIRY_MARGIN_SECONDS <= nowSeconds;
  } catch {
    return true;
  }
}

/** トークンを確かめて、本人のセッションのクライアントを作る。確かめられなければ null。 */
export async function bearerSessionClient(
  token: string,
): Promise<{ client: SupabaseClient<Database>; userId: string } | null> {
  if (isExpiringToken(token)) return null;
  const env = getPublicEnv();
  const client = createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  // 期限内のトークンなら、Supabase に本人を問い合わせて(本物か確かめて)セッションにする。
  // リフレッシュトークンは使わない(期限内なので更新は起きない)。
  const { data, error } = await client.auth.setSession({
    access_token: token,
    refresh_token: 'not-sent-by-mobile',
  });
  if (error || !data.user) return null;
  return { client, userId: data.user.id };
}

export type MobileContext = { userId: string };

const unauthorized = () => Response.json({ error: 'ログインし直してください' }, { status: 401 });

/**
 * iPhone アプリ用の入口(`/api/mobile/*`)の包み。トークンを確かめ、本人のセッションの間に
 * `handler` を動かす。確かめられなければ 401。
 */
export function withMobileSession(
  handler: (request: Request, ctx: MobileContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const token = bearerTokenOf(request);
    if (!token) return unauthorized();
    const session = await bearerSessionClient(token).catch(() => null);
    if (!session) return unauthorized();
    return runWithSessionClient(session.client, () => handler(request, { userId: session.userId }));
  };
}
