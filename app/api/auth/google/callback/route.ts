import { cookies } from 'next/headers';

import { getGoogleClientCredentials } from '@/lib/env';
import { exchangeGoogleAuthorizationCode } from '@/lib/google-auth';
import { STATE_COOKIE } from '../start/route';

/**
 * Google 連携の同意フロー、戻り先(本人発案)。
 *
 * ── refresh_token を DB に保存しない理由 ────────────────────
 * ADR-014(秘密情報は環境変数、DB にもリポジトリにも入れない)に従う。
 * ここでは受け取った refresh_token を画面に一度だけ表示するだけにし、
 * 本人が Vercel の環境変数 + GitHub Secrets へ手でコピーする運用にする
 * (CRON_SECRET と同じ「発行したら環境変数にコピーする」パターン)。
 * このレスポンスはキャッシュされないようにする(Cache-Control: no-store)。
 */

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (oauthError) {
    return errorPage(`Google の同意が得られませんでした(${oauthError})。`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return errorPage(
      '不正なリクエストです(state が一致しません)。/settings/google からやり直してください。',
    );
  }

  try {
    const { clientId, clientSecret } = getGoogleClientCredentials();
    const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
    const tokens = await exchangeGoogleAuthorizationCode(clientId, clientSecret, redirectUri, code);

    if (!tokens.refreshToken) {
      return errorPage(
        '同意はできましたが refresh_token が発行されませんでした。' +
          'Google アカウントの「サードパーティ製アプリとサービスへのアクセス権」から' +
          'このアプリのアクセスを一度削除してから、もう一度 /settings/google をお試しください。' +
          '(https://myaccount.google.com/permissions)',
      );
    }

    return tokenPage(tokens.refreshToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorPage(`Google との連携に失敗しました: ${message}`);
  }
}

function htmlResponse(bodyHtml: string): Response {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta name="robots" content="noindex">` +
      `<title>Google連携</title>` +
      `<style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px;
               margin: 40px auto; padding: 0 16px; line-height: 1.7; color: #0a1020; }
        code, pre { background: #eef1f6; padding: 2px 6px; border-radius: 6px;
                    word-break: break-all; white-space: pre-wrap; }
        pre { padding: 12px; }
        .warn { color: #e34948; font-weight: 600; }
      </style></head><body>${bodyHtml}</body></html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    },
  );
}

function errorPage(message: string): Response {
  return htmlResponse(`<h1>連携できませんでした</h1><p>${escapeHtml(message)}</p>`);
}

function tokenPage(refreshToken: string): Response {
  return htmlResponse(`
    <h1>連携できました</h1>
    <p>下の値を <strong>今すぐ</strong> コピーして、Vercel の環境変数と GitHub Secrets に
    <code>GOOGLE_REFRESH_TOKEN</code> として設定してください。このページを閉じると、
    もう一度見ることはできません(再表示するには、もう一度この連携をやり直す必要があります)。</p>
    <pre>${escapeHtml(refreshToken)}</pre>
    <p class="warn">この値は本人の Google アカウントを操作できる鍵です。他人に見せたり、
    画面のスクリーンショットを共有したりしないでください。</p>
    <p><a href="/settings/google">/settings/google に戻る</a></p>
  `);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
