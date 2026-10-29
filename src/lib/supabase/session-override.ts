/**
 * 本人のセッション(cookie)が無い経路で、本人のセッションの Supabase クライアントを `createClient()`
 * (server.ts)に渡す(ADR-130・132)。
 *
 * - LINE の受信・AI とつなぐ(MCP):送り主を確かめたあと、本人として作ったセッション(owner-session.ts、
 *   本人ごとに1つを使い回す。ADR-145)。
 * - iPhone アプリ:アプリが送ったログインの証明(アクセストークン)を確かめたセッション(bearer-session.ts)。
 *
 * どちらも RLS のまま(本人の行だけ)で、この処理のあいだだけ渡す。ここではクライアントを預かるだけで、
 * 本人かどうかは呼ぶ側が確かめる。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './types';

const store = new AsyncLocalStorage<SupabaseClient<Database>>();

/** 本人として動いている間の Supabase クライアント(それ以外は undefined)。 */
export function sessionOverrideClient(): SupabaseClient<Database> | undefined {
  return store.getStore();
}

/** `fn` の間だけ、`createClient()` が `client` を返す。本人かどうかは呼ぶ側が確かめておくこと。 */
export function runWithSessionClient<T>(
  client: SupabaseClient<Database>,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(client, fn);
}
