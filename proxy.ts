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
 *
 * ログイン画面は、ログイン済みならホームへ送る(ログインのあと画面が切り替わらず、
 * ログイン画面に取り残されるのを防ぐ。ADR-081)。
 *
 * /api/webhooks/* も対象外。LINE のサーバーがセッション cookie を持たずに
 * 直接叩いてくる経路のため(本人発案のレシート受信 Webhook)。X-Line-Signature
 * による検証は各 route.ts 側の責務にする(app/api/webhooks/line/route.ts)。
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { authGate, isPublicPath } from '@/lib/auth-gate';
import { getPublicEnv } from '@/lib/env';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
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

  const gate = authGate(pathname, user !== null);
  if (gate === 'unauthorized') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (gate === 'to-login' || gate === 'to-home') {
    const url = request.nextUrl.clone();
    url.pathname = gate === 'to-login' ? '/login' : '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|api/cron|api/webhooks).*)'],
};
