/**
 * ブラウザ用の Supabase クライアント(M0-3)。
 *
 * anon キーのみを使う。RLS が守る範囲でしか読み書きできないので、
 * このキーがブラウザに出ること自体はリスクにならない(ADR-011)。
 * セッションは cookie に持つため、同じログイン状態がサーバー側の
 * createClient(server.ts)からも見える。
 */
'use client';

import { createBrowserClient } from '@supabase/ssr';

import { getPublicEnv } from '@/lib/env';
import type { Database } from './types';

export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
