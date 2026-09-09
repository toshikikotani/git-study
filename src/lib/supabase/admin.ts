/**
 * 管理用の Supabase クライアント(M0-3)。
 *
 * service_role キーを使い、RLS を越える(ADR-011)。本人のリクエスト経路
 * (Server Component / Route Handler で本人として読み書きする経路)には
 * 使わないこと。cron ジョブ・AI 分類など、システム自身がユーザーの代わりに
 * データへ触れる場面専用。
 *
 * import 'server-only' はビルド時のガード。誤ってクライアント component
 * から import すると、この時点でビルドが失敗する(NFR-04)。
 */
import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getPublicEnv, getSupabaseServiceRoleKey } from '@/lib/env';
import type { Database } from './types';

export function createAdminClient() {
  const publicEnv = getPublicEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
