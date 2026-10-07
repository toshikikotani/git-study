'use server';

/**
 * ログアウト。セッションの cookie を消して、ログイン画面へ戻る。
 * 失敗しても(通信できないなど)ログイン画面へ戻す。もう一度ログインできる。
 *
 * ログイン画面はログイン済みならホームへ送る(ADR-083)ので、サインアウトが通信で失敗しても
 * セッションの cookie は必ず消す(消さないと、ログイン画面へ戻れずホームに戻されてしまう)。
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // ここで止めない。
  }
  try {
    const jar = await cookies();
    for (const { name } of jar.getAll()) {
      if (name.startsWith('sb-') && name.includes('auth-token')) jar.delete(name);
    }
  } catch {
    // ここでも止めない。
  }
  redirect('/login');
}
