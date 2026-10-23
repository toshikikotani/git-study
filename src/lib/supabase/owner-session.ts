/**
 * LINE の受信など、本人のセッション(cookie)が無いサーバーどうしの経路で、本人(オーナー)として
 * アプリの読み書きをする(v4-2「LINEで完結」、ADR-130)。
 *
 * AIの窓口・今日の目安・もし使ったらは、本人のセッションの Supabase クライアント(RLS で本人の行だけ)を
 * 前提に組んである。これらを LINE からも同じ計算で使うため、この中で動く間だけ `createClient()`
 * (server.ts)が、本人として発行した一時的なセッションのクライアントを返す。
 *
 *   - 呼べるのは、送り主を確かめた経路だけ(LINE の署名と LINE_USER_ID を確かめた Webhook)。
 *   - 管理クライアント(RLS を越える)より狭い:本人の行しか見えない・書けない(RLS のまま)。
 *   - セッションはこの処理のためだけに作り、終わったらすぐ無効にする(使い回さない・外へ出さない)。
 *   - 新しいログインの方法ではない(本人がこの経路でログインすることはできない)。
 *
 * server.ts(next/headers を使うのでサーバーでしか動かない)からだけ読む。管理クライアントの型だけを使い、
 * 管理キーそのものはここで読まない。
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { getPublicEnv } from '@/lib/env';
import type { createAdminClient } from './admin';
import type { OwnerUser } from './owner';
import { runWithSessionClient, sessionOverrideClient } from './session-override';
import type { Database } from './types';

/** 本人として動いている間の Supabase クライアント(それ以外は undefined)。 */
export const ownerSessionClient = sessionOverrideClient;

export class OwnerSessionError extends Error {}

/** `fn` を本人(オーナー)のセッションで動かす。 */
export async function runAsOwner<T>(
  admin: ReturnType<typeof createAdminClient>,
  owner: OwnerUser,
  fn: () => Promise<T>,
): Promise<T> {
  if (!owner.email) throw new OwnerSessionError('本人のメールアドレスが分かりません');
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: owner.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new OwnerSessionError(`本人として読めませんでした: ${linkError?.message ?? ''}`);
  }

  const env = getPublicEnv();
  const client = createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyError || verified.user?.id !== owner.id) {
    throw new OwnerSessionError(`本人として読めませんでした: ${verifyError?.message ?? ''}`);
  }

  try {
    return await runWithSessionClient(client, fn);
  } finally {
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}
