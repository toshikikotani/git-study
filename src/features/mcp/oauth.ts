/**
 * AI とつなぐ(MCP)の OAuth(ChatGPT・Claude のアプリから、ログインしてつなぐ、ADR-143)。
 *
 * MCP の認可の決まり(OAuth 2.1 + PKCE、動的なクライアント登録、メタデータ)に合わせる。表を増やさない
 * (データベースへの適用は不要)ため、次のように持つ:
 *   - クライアントの登録・認可コード・アクセストークン・リフレッシュトークンは、サーバーの秘密
 *     (SUPABASE_SERVICE_ROLE_KEY から HKDF で作った鍵)で署名した文字列。中身を書き換えると通らない。
 *   - 「つないだアプリ」(grant)だけを本人(オーナー)の app_metadata に置く。トークンは grant が
 *     残っている間だけ使える(設定から取り消すと、その場で使えなくなる)。認可コードは1回だけ
 *     (grant にコードのハッシュを持ち、交換したら消す)。リフレッシュトークンは使うたびに入れ替わる
 *     (grant の世代と合うものだけ通す)。
 *
 * 認可できるのは持ち主(オーナー)だけ。道具は server.ts(書く道具はチャットで本人が許可したときだけ、ADR-144)。
 */
import 'server-only';

import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import { getSupabaseServiceRoleKey } from '@/lib/env';
import type { OwnerUser } from '@/lib/supabase/owner';
import { loadOwnerMetadata } from './tokens';

type Admin = ReturnType<typeof createAdminClient>;

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 5 * 60;
/** 同時につないでおけるアプリの数(多ければ古い順に外す)。 */
export const MAX_GRANTS = 10;
export const OAUTH_SCOPE = 'kakeibo.read';

const PREFIX = {
  client: 'kcl_',
  code: 'kkc_',
  access: 'kka_',
  refresh: 'kkr_',
} as const;

// ---- 署名 -----------------------------------------------------------------------

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function signingKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', getSupabaseServiceRoleKey(), 'kakeibo', 'mcp-oauth-v1', 32),
  );
}

function mac(prefix: string, body: string): string {
  return createHmac('sha256', signingKey()).update(`${prefix}${body}`).digest('base64url');
}

function sign(prefix: string, payload: object): string {
  const body = b64url(JSON.stringify(payload));
  return `${prefix}${body}.${mac(prefix, body)}`;
}

function unsign<T>(prefix: string, token: string): T | null {
  if (!token.startsWith(prefix) || token.length > 4000) return null;
  const rest = token.slice(prefix.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sent = Buffer.from(rest.slice(dot + 1));
  const mine = Buffer.from(mac(prefix, body));
  if (sent.length !== mine.length || !timingSafeEqual(sent, mine)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

// ---- クライアントの登録(RFC 7591、状態を持たない) --------------------------------

type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
type ClientPayload = { n: string; r: string[]; m: AuthMethod; t: number };
export type OAuthClient = { id: string; name: string; redirectUris: string[]; method: AuthMethod };

/** 戻り先にしてよい URL:https か、手元(localhost)の http。断片(#)は持たない。 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== '' || value.length > 500) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

const clientSecretOf = (clientId: string) => mac('kcs_', sha256(clientId));

export function registerClient(
  meta: Record<string, unknown>,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string; description: string } {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris が要ります' };
  }
  if (!uris.every((u): u is string => typeof u === 'string' && isAllowedRedirectUri(u))) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description: 'redirect_uris は https(または localhost)の URL にしてください',
    };
  }
  const requested = meta.token_endpoint_auth_method;
  const method: AuthMethod =
    requested === 'client_secret_post' || requested === 'client_secret_basic' ? requested : 'none';
  const name =
    typeof meta.client_name === 'string' && meta.client_name.trim() !== ''
      ? meta.client_name.trim().slice(0, 60)
      : 'AI';
  const issuedAt = now();
  const clientId = sign(PREFIX.client, { n: name, r: uris, m: method, t: issuedAt });
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      ...(method === 'none'
        ? {}
        : { client_secret: clientSecretOf(clientId), client_secret_expires_at: 0 }),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: OAUTH_SCOPE,
    },
  };
}

export function readClient(clientId: string): OAuthClient | null {
  const p = unsign<ClientPayload>(PREFIX.client, clientId);
  if (!p || typeof p.n !== 'string' || !Array.isArray(p.r)) return null;
  return { id: clientId, name: p.n, redirectUris: p.r, method: p.m ?? 'none' };
}

/** トークンの入口でのクライアントの確かめ(公開クライアントは secret なし、PKCE で守る)。 */
export function authenticateClient(
  clientId: string,
  clientSecret: string | null,
): OAuthClient | null {
  const client = readClient(clientId);
  if (!client) return null;
  if (client.method === 'none') return client;
  if (clientSecret === null) return null;
  const a = Buffer.from(clientSecret);
  const b = Buffer.from(clientSecretOf(clientId));
  return a.length === b.length && timingSafeEqual(a, b) ? client : null;
}

// ---- 認可の求め(/oauth/authorize) ----------------------------------------------

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
};

/**
 * 認可の求めを確かめる。戻り先が確かめられないうちの誤りは、画面に出す(知らない所へ飛ばさない)。
 * 戻り先が確かなあとの誤りは、戻り先へ error を付けて返す。
 */
export function parseAuthorizeRequest(
  params: URLSearchParams,
  mcpUrl: string,
):
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; show: string }
  | { ok: false; redirect: string } {
  const client = readClient(params.get('client_id') ?? '');
  if (!client)
    return { ok: false, show: 'このアプリは登録されていません。アプリからつなぎ直してください。' };
  const asked = params.get('redirect_uri');
  const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : null);
  if (redirectUri === null || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, show: '戻り先が登録と違います。アプリからつなぎ直してください。' };
  }
  const state = params.get('state');
  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (state !== null) url.searchParams.set('state', state);
    return { ok: false as const, redirect: url.toString() };
  };
  if (params.get('response_type') !== 'code') {
    return back('unsupported_response_type', 'response_type は code だけです');
  }
  const codeChallenge = params.get('code_challenge') ?? '';
  if (
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
    params.get('code_challenge_method') !== 'S256'
  ) {
    return back('invalid_request', 'PKCE(S256)が要ります');
  }
  const resource = params.get('resource');
  if (resource !== null && resource.replace(/\/$/, '') !== mcpUrl) {
    return back('invalid_target', 'この家計簿の MCP の URL ではありません');
  }
  return { ok: true, request: { client, redirectUri, codeChallenge, state, resource: mcpUrl } };
}

// ---- つないだアプリ(grant) -----------------------------------------------------

export type McpGrant = {
  id: string;
  clientName: string;
  /** クライアント id のハッシュ(先頭32字)。 */
  clientKey: string;
  redirectHost: string;
  createdAt: string;
  /** まだ交換していない認可コードのハッシュ。交換したら null。 */
  codeHash: string | null;
  /** リフレッシュトークンの世代(使うたびに1つ進む)。 */
  gen: number;
  lastUsedAt: string | null;
};

export type McpGrantView = Pick<
  McpGrant,
  'id' | 'clientName' | 'redirectHost' | 'createdAt' | 'lastUsedAt'
>;

export function grantsOf(metadata: unknown): McpGrant[] {
  const raw = (metadata as { mcp_grants?: unknown } | null | undefined)?.mcp_grants;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (g): g is McpGrant =>
      typeof g === 'object' &&
      g !== null &&
      typeof (g as McpGrant).id === 'string' &&
      typeof (g as McpGrant).clientKey === 'string' &&
      typeof (g as McpGrant).gen === 'number',
  );
}

export const grantView = (g: McpGrant): McpGrantView => ({
  id: g.id,
  clientName: g.clientName,
  redirectHost: g.redirectHost,
  createdAt: g.createdAt,
  lastUsedAt: g.lastUsedAt,
});

const clientKeyOf = (clientId: string) => sha256(clientId).slice(0, 32);

async function saveGrants(
  admin: Admin,
  ownerId: string,
  metadata: Record<string, unknown>,
  grants: readonly McpGrant[],
): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(ownerId, {
    app_metadata: { ...metadata, mcp_grants: grants },
  });
  if (error) throw new Error('つないだアプリを保存できませんでした。');
}

type CodePayload = { g: string; c: string; r: string; ch: string; res: string; exp: number };
type AccessPayload = { g: string; aud: string; exp: number };
type RefreshPayload = { g: string; n: number; exp: number };

/** 本人が「許可する」を押したとき:つないだアプリを作り、認可コード付きの戻り先を返す。 */
export async function approveAuthorization(
  admin: Admin,
  userId: string,
  request: AuthorizeRequest,
  issuer: string,
): Promise<string> {
  const { owner, metadata } = await loadOwnerMetadata(admin);
  if (owner.id !== userId) throw new Error('家計簿の持ち主だけが許可できます。');
  const grant: McpGrant = {
    id: randomUUID(),
    clientName: request.client.name,
    clientKey: clientKeyOf(request.client.id),
    redirectHost: new URL(request.redirectUri).host,
    createdAt: new Date().toISOString(),
    codeHash: null,
    gen: 0,
    lastUsedAt: null,
  };
  const code = sign(PREFIX.code, {
    g: grant.id,
    c: grant.clientKey,
    r: request.redirectUri,
    ch: request.codeChallenge,
    res: request.resource,
    exp: now() + CODE_TTL_SECONDS,
  } satisfies CodePayload);
  grant.codeHash = sha256(code);
  // 同じアプリをつなぎ直したら、前のつながりは外す。多すぎれば古い順に外す。
  const others = grantsOf(metadata).filter((g) => g.clientKey !== grant.clientKey);
  await saveGrants(admin, owner.id, metadata, [...others, grant].slice(-MAX_GRANTS));

  const url = new URL(request.redirectUri);
  url.searchParams.set('code', code);
  if (request.state !== null) url.searchParams.set('state', request.state);
  url.searchParams.set('iss', issuer);
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export class OAuthError extends Error {
  constructor(
    readonly code:
      'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type',
    message: string,
  ) {
    super(message);
  }
}

function issueTokens(grant: McpGrant, resource: string): TokenResponse {
  return {
    access_token: sign(PREFIX.access, {
      g: grant.id,
      aud: resource,
      exp: now() + ACCESS_TOKEN_TTL_SECONDS,
    } satisfies AccessPayload),
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: sign(PREFIX.refresh, {
      g: grant.id,
      n: grant.gen,
      exp: now() + REFRESH_TOKEN_TTL_SECONDS,
    } satisfies RefreshPayload),
    scope: OAUTH_SCOPE,
  };
}

const pkceOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** 認可コードをトークンに換える(1回だけ、PKCE を確かめる)。 */
export async function exchangeCode(
  admin: Admin,
  input: { client: OAuthClient; code: string; redirectUri: string | null; codeVerifier: string },
): Promise<TokenResponse> {
  const payload = unsign<CodePayload>(PREFIX.code, input.code);
  if (!payload || payload.exp < now())
    throw new OAuthError('invalid_grant', 'コードが違うか、期限が切れています');
  if (payload.c !== clientKeyOf(input.client.id))
    throw new OAuthError('invalid_grant', '別のアプリのコードです');
  if (input.redirectUri !== null && input.redirectUri !== payload.r) {
    throw new OAuthError('invalid_grant', '戻り先が違います');
  }
  if (
    !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier) ||
    pkceOf(input.codeVerifier) !== payload.ch
  ) {
    throw new OAuthError('invalid_grant', 'PKCE の確かめに失敗しました');
  }
  const { owner, metadata } = await loadOwnerMetadata(admin);
  const grants = grantsOf(metadata);
  const grant = grants.find((g) => g.id === payload.g);
  if (!grant || grant.codeHash === null || grant.codeHash !== sha256(input.code)) {
    throw new OAuthError('invalid_grant', 'このコードはもう使われたか、取り消されています');
  }
  const next: McpGrant = { ...grant, codeHash: null, gen: 1, lastUsedAt: new Date().toISOString() };
  await saveGrants(
    admin,
    owner.id,
    metadata,
    grants.map((g) => (g.id === grant.id ? next : g)),
  );
  return issueTokens(next, payload.res);
}

/** リフレッシュトークンで入れ替える(使ったトークンは次から使えない)。 */
export async function refreshTokens(
  admin: Admin,
  input: { client: OAuthClient; refreshToken: string; resource: string },
): Promise<TokenResponse> {
  const payload = unsign<RefreshPayload>(PREFIX.refresh, input.refreshToken);
  if (!payload || payload.exp < now())
    throw new OAuthError('invalid_grant', 'リフレッシュトークンが違うか、期限が切れています');
  const { owner, metadata } = await loadOwnerMetadata(admin);
  const grants = grantsOf(metadata);
  const grant = grants.find((g) => g.id === payload.g);
  if (!grant || grant.clientKey !== clientKeyOf(input.client.id) || grant.gen !== payload.n) {
    throw new OAuthError('invalid_grant', 'つながりが取り消されたか、古いトークンです');
  }
  const next: McpGrant = { ...grant, gen: grant.gen + 1, lastUsedAt: new Date().toISOString() };
  await saveGrants(
    admin,
    owner.id,
    metadata,
    grants.map((g) => (g.id === grant.id ? next : g)),
  );
  return issueTokens(next, input.resource);
}

/** MCP の入口:アクセストークンを確かめ、合えば本人(オーナー)を返す。 */
export async function verifyAccessToken(
  admin: Admin,
  token: string,
  mcpUrl: string,
): Promise<OwnerUser | null> {
  const payload = unsign<AccessPayload>(PREFIX.access, token);
  if (!payload || payload.exp < now() || payload.aud !== mcpUrl) return null;
  const { owner, metadata } = await loadOwnerMetadata(admin);
  return grantsOf(metadata).some((g) => g.id === payload.g && g.codeHash === null) ? owner : null;
}

export function isAccessToken(token: string): boolean {
  return token.startsWith(PREFIX.access);
}

/** つないだアプリの一覧(本人だけ)。 */
export async function listGrants(admin: Admin, userId: string): Promise<McpGrantView[]> {
  const { owner, metadata } = await loadOwnerMetadata(admin);
  return owner.id === userId
    ? grantsOf(metadata)
        .filter((g) => g.gen > 0)
        .map(grantView)
    : [];
}

/** つないだアプリを外す(そのアプリのトークンは、その場で使えなくなる)。 */
export async function revokeGrant(admin: Admin, userId: string, id: string): Promise<void> {
  const { owner, metadata } = await loadOwnerMetadata(admin);
  if (owner.id !== userId) throw new Error('家計簿の持ち主だけが外せます。');
  await saveGrants(
    admin,
    owner.id,
    metadata,
    grantsOf(metadata).filter((g) => g.id !== id),
  );
}

// ---- メタデータ(RFC 9728・RFC 8414) --------------------------------------------

/** この家計簿の入口の URL(リクエストの来た先で決める。プレビューの URL でもそのまま動く)。 */
export function oauthUrls(origin: string) {
  const issuer = origin.replace(/\/$/, '');
  return {
    issuer,
    mcp: `${issuer}/api/mcp`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/api/mcp`,
    authorize: `${issuer}/oauth/authorize`,
    token: `${issuer}/api/oauth/token`,
    register: `${issuer}/api/oauth/register`,
  };
}

export function protectedResourceMetadata(origin: string) {
  const u = oauthUrls(origin);
  return {
    resource: u.mcp,
    authorization_servers: [u.issuer],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: '家計簿',
  };
}

export function authorizationServerMetadata(origin: string) {
  const u = oauthUrls(origin);
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  };
}
