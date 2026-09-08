/**
 * Magic Link のコールバック(M0-3、ADR-011)。
 *
 * ログインリンクの ?code= をセッションに交換する。ここで初めて
 * cookie が書けるので(Route Handler)、交換はここでしか完結しない。
 *
 * Magic Link は復旧経路(パスワード未設定・失念時)としてのみ残っているため、
 * ログイン後は毎回パスワード設定画面へ促す。設定済みの本人はそのまま
 * 次回からパスワードでログインできる。
 */
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/settings/password`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
