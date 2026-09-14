import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getGoogleClientCredentials } from '@/lib/env';
import { buildGoogleAuthorizeUrl } from '@/lib/google-auth';

/**
 * Google 連携の同意フロー、入口(本人発案)。
 *
 * `/settings/google` の「連携する」リンクがここへ来る。proxy.ts の関所が
 * 守るため、ログイン中の本人しかここに到達できない。state を短命 cookie に
 * 積んでから Google の同意画面へ飛ばし、コールバック側で一致を確認する
 * (CSRF 対策)。
 */

export const runtime = 'nodejs';

export const STATE_COOKIE = 'google_oauth_state';

export function GET(request: Request): NextResponse {
  let clientId: string;
  try {
    ({ clientId } = getGoogleClientCredentials());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です: ${message}` },
      { status: 500 },
    );
  }

  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const state = randomBytes(16).toString('hex');

  const response = NextResponse.redirect(buildGoogleAuthorizeUrl(clientId, redirectUri, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 300,
    path: '/api/auth/google',
  });
  return response;
}
