/**
 * Google OAuth2 のクライアント(本人発案:カレンダー同期・スプレッドシート連携)。
 *
 * このアプリはシングルユーザーなので、サービスアカウントではなく本人の
 * 個人 Google アカウントに対する OAuth2(offline access)を使う。一度だけ
 * `/settings/google` で同意すれば、以降は refresh_token だけで
 * access_token を取り直せる(cron ジョブに本人のセッションは無いため、
 * 有効期限の短い access_token だけを持たせるわけにはいかない)。
 *
 * ここは Google という外部サービスのクライアントに徹する(lib/discord.ts
 * と同じ役割分担)。refresh_token をどこに保存するか・いつ呼ぶかは
 * 呼び出し側(app/api/auth/google・features/google/*)の責務。
 */

import { AppError } from '@/lib/errors';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** カレンダーの読み書きとスプレッドシートの読み書き(バックアップ先の新規作成も含む)。 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

export class GoogleAuthError extends AppError {}

/**
 * 同意画面への URL。state は CSRF 対策(呼び出し側が短命 cookie 等で
 * 発行し、コールバックで一致を確認すること)。
 *
 * prompt=consent を毎回付ける:2回目以降の同意では refresh_token が
 * 返らないことがある(Google の既定動作)ため、再接続のたびに確実に
 * 発行させる。
 */
export function buildGoogleAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type GoogleTokens = {
  accessToken: string;
  /** 同意フローの初回だけ返る(以降の refresh では返らない)。 */
  refreshToken: string | null;
};

/** 認可コードをトークンに交換する(同意フローで一度だけ呼ぶ)。 */
export async function exchangeGoogleAuthorizationCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<GoogleTokens> {
  return requestToken({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: 'authorization_code',
  });
}

/** refresh_token から新しい access_token を取る(cron ジョブが毎回呼ぶ)。 */
export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const tokens = await requestToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return tokens.accessToken;
}

async function requestToken(body: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !json?.access_token) {
    const detail = json?.error_description ?? json?.error ?? `ステータス ${response.status}`;
    throw new GoogleAuthError(`Google の認証に失敗しました: ${detail}`);
  }

  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null };
}
