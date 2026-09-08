/**
 * Server Component / Route Handler / Server Action 用の Supabase クライアント(M0-3)。
 *
 * anon キー + 本人のセッション cookie で動く。RLS がそのまま効くので、
 * ここ経由の問い合わせは常に「ログイン中の本人の行」だけを返す。
 * 管理者権限が要る処理(cron・AI 分類など)には admin.ts を使うこと。
 *
 * リクエストのたびに新しいクライアントを作ること。使い回すと、
 * 別リクエストのセッションが混ざる。
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getPublicEnv } from '@/lib/env';
import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれた場合は cookie を書けない(Next.js の制約)。
            // セッションの更新は middleware が担うので、ここでは無視してよい。
          }
        },
      },
    },
  );
}
