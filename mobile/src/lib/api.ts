/**
 * サーバーの iPhone 用の入口(/api/mobile/*、ADR-132)を呼ぶ。ログインの証明(アクセストークン)を
 * 付け、期限が近ければ先に更新する。401 が返ったら一度だけ更新して送り直す。
 */
import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 期限まで1分を切ったトークンは、送る前に更新する(サーバーは期限の近いトークンを受け付けない)。 */
const REFRESH_BEFORE_MS = 60_000;

async function accessToken(force = false): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (force || expiresAt - Date.now() < REFRESH_BEFORE_MS) {
    const refreshed = await supabase.auth.refreshSession();
    return refreshed.data.session?.access_token ?? null;
  }
  return session.access_token;
}

export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const send = async (token: string | null) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
    try {
      return await fetch(`${env.apiBaseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await send(await accessToken());
    if (response.status === 401) response = await send(await accessToken(true));
  } catch {
    throw new ApiError('つながりませんでした。電波のよい所で、もう一度試してください。', 0);
  }
  const json = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (response.status === 401) throw new ApiError('ログインし直してください。', 401);
  if (json === null) throw new ApiError('サーバーの返事が読めませんでした。', response.status);
  if (!response.ok && typeof json.error === 'string' && !('records' in json || 'record' in json)) {
    throw new ApiError(json.error, response.status);
  }
  return json;
}
