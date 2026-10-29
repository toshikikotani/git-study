import { json, originOf, preflight } from '@/features/mcp/http';
import {
  authenticateClient,
  exchangeCode,
  OAuthError,
  oauthUrls,
  refreshTokens,
} from '@/features/mcp/oauth';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * トークンの入口(OAuth 2.1、ADR-143)。認可コード(PKCE を確かめる)と、リフレッシュトークンの入れ替えだけ。
 * 認可コードは1回だけ、リフレッシュトークンは使うたびに入れ替わる(oauth.ts)。
 */
export const runtime = 'nodejs';

const fail = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, { status });

/** client_secret_basic(Authorization: Basic …)なら、id と secret を取り出す。 */
function basicCredentials(request: Request): { id: string; secret: string } | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, colon)),
    secret: decodeURIComponent(decoded.slice(colon + 1)),
  };
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (form === null)
    return fail('invalid_request', 'application/x-www-form-urlencoded で送ってください');
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const basic = basicCredentials(request);
  const clientId = basic?.id ?? field('client_id');
  if (clientId === null) return fail('invalid_client', 'client_id が要ります', 401);
  const client = authenticateClient(clientId, basic?.secret ?? field('client_secret'));
  if (client === null) return fail('invalid_client', 'このアプリは登録されていません', 401);

  const urls = oauthUrls(originOf(request.headers, request.url));
  try {
    const admin = createAdminClient();
    const grantType = field('grant_type');
    if (grantType === 'authorization_code') {
      const code = field('code');
      const verifier = field('code_verifier');
      if (code === null || verifier === null) {
        return fail('invalid_request', 'code と code_verifier が要ります');
      }
      return json(
        await exchangeCode(admin, {
          client,
          code,
          redirectUri: field('redirect_uri'),
          codeVerifier: verifier,
        }),
      );
    }
    if (grantType === 'refresh_token') {
      const refreshToken = field('refresh_token');
      if (refreshToken === null) return fail('invalid_request', 'refresh_token が要ります');
      return json(await refreshTokens(admin, { client, refreshToken, resource: urls.mcp }));
    }
    return fail('unsupported_grant_type', 'authorization_code と refresh_token だけです');
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.code, error.message);
    return fail('server_error', 'いまはつなげません。少し待ってください。', 500);
  }
}

export const OPTIONS = preflight;
