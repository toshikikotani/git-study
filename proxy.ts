/**
 * 認証ガード(M0-3、NFR-04)。
 *
 * ここが唯一の関所。未ログインで (app) 配下や /api/* に来たら弾く。
 * 画面には /login へリダイレクト、API には 401 を返す(API を HTML の
 * ログイン画面へ飛ばしても呼び出し側は解釈できない)。
 *
 * セッションの更新もここで行う。Supabase のアクセストークンは短命で、
 * getUser() を呼ぶとここで自動的に更新される。Server Component は
 * cookie を書けないため、更新を担えるのは実質ここだけ(server.ts 参照)。
 *
 * /api/cron/* は対象外。cron ジョブはブラウザのセッション cookie を
 * 持たず、CRON_SECRET で自分自身を認証する(ADR-009、M2-7c で実装)。
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getPublicEnv } from '@/lib/env';

const PUBLIC_PATHS = ['/login', '/auth/callback'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const env = getPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|api/cron).*)'],
};
