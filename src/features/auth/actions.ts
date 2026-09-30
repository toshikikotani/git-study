'use server';

/**
 * ログアウト。セッションの cookie を消して、ログイン画面へ戻る。
 * 失敗しても(通信できないなど)ログイン画面へ戻す。もう一度ログインできる。
 */

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // ここで止めない。
  }
  redirect('/login');
}
