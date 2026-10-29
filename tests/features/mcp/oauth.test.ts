/**
 * AI のアプリとつなぐ OAuth(ADR-143):登録・同意・コード(1回だけ・PKCE)・トークン・入れ替え・外す。
 * 案内(メタデータ)は MCP の公式 SDK の形で確かめる。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const s = vi.hoisted(() => ({ metadata: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/owner', () => ({
  findOwner: async () => ({
    user: { id: 'me', email: 'me@example.com', created_at: '' },
    error: null,
  }),
}));

import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import {
  approveAuthorization,
  authorizationServerMetadata,
  authenticateClient,
  exchangeCode,
  grantsOf,
  isAllowedRedirectUri,
  listGrants,
  oauthUrls,
  parseAuthorizeRequest,
  protectedResourceMetadata,
  readClient,
  refreshTokens,
  registerClient,
  revokeGrant,
  verifyAccessToken,
} from '@/features/mcp/oauth';
import { safeLoginNext } from '@/lib/login-next';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-0123456789';

const admin = {
  auth: {
    admin: {
      getUserById: async () => ({ data: { user: { app_metadata: s.metadata } }, error: null }),
      updateUserById: async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
        s.metadata = structuredClone(attrs.app_metadata);
        return { data: {}, error: null };
      },
    },
  },
} as never;

const ORIGIN = 'https://kakeibo.example';
const urls = oauthUrls(ORIGIN);
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'v'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function register(extra: Record<string, unknown> = {}) {
  const r = registerClient({ client_name: 'ChatGPT', redirect_uris: [REDIRECT], ...extra });
  if (!r.ok) throw new Error(r.description);
  return r.body as { client_id: string; client_secret?: string };
}

function authorizeParams(clientId: string, over: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st-1',
    resource: urls.mcp,
    ...over,
  });
}

async function codeFor(clientId: string) {
  const parsed = parseAuthorizeRequest(authorizeParams(clientId), urls.mcp);
  if (!parsed.ok) throw new Error('parse');
  const back = new URL(await approveAuthorization(admin, 'me', parsed.request, urls.issuer));
  return { back, code: back.searchParams.get('code')! };
}

beforeEach(() => {
  s.metadata = { mcp_tokens: [] };
});

describe('案内(メタデータ)', () => {
  it('MCP の SDK が読める形で、登録・認可・トークンの入口と PKCE(S256)を出す', () => {
    const resource = OAuthProtectedResourceMetadataSchema.parse(protectedResourceMetadata(ORIGIN));
    expect(resource.resource).toBe('https://kakeibo.example/api/mcp');
    expect(resource.authorization_servers).toEqual(['https://kakeibo.example']);
    const server = OAuthMetadataSchema.parse(authorizationServerMetadata(ORIGIN));
    expect(server).toMatchObject({
      issuer: 'https://kakeibo.example',
      authorization_endpoint: 'https://kakeibo.example/oauth/authorize',
      token_endpoint: 'https://kakeibo.example/api/oauth/token',
      registration_endpoint: 'https://kakeibo.example/api/oauth/register',
      code_challenge_methods_supported: ['S256'],
    });
  });
});

describe('登録', () => {
  it('戻り先は https か手元だけ。書き換えた client_id は通らない', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:6274/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://a.example/cb#x')).toBe(false);
    expect(registerClient({ redirect_uris: ['http://evil.example/cb'] }).ok).toBe(false);
    expect(registerClient({}).ok).toBe(false);

    const { client_id } = register();
    expect(readClient(client_id)).toMatchObject({ name: 'ChatGPT', redirectUris: [REDIRECT] });
    expect(readClient(client_id.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
  });

  it('secret を求めたクライアントは secret が合うときだけ通す', () => {
    const { client_id, client_secret } = register({
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(client_secret).toBeTruthy();
    expect(authenticateClient(client_id, client_secret!)).not.toBeNull();
    expect(authenticateClient(client_id, 'wrong')).toBeNull();
    expect(authenticateClient(client_id, null)).toBeNull();
    const pub = register();
    expect(authenticateClient(pub.client_id, null)).not.toBeNull();
  });
});

describe('認可の求め', () => {
  it('戻り先が確かでなければ画面に出し、確かなら戻り先へ error を返す', () => {
    const { client_id } = register();
    expect(parseAuthorizeRequest(authorizeParams('kcl_bad.sig'), urls.mcp)).toMatchObject({
      ok: false,
      show: expect.any(String),
    });
    expect(
      parseAuthorizeRequest(
        authorizeParams(client_id, { redirect_uri: 'https://evil.example/cb' }),
        urls.mcp,
      ),
    ).toMatchObject({ ok: false, show: expect.any(String) });
    const plain = parseAuthorizeRequest(
      authorizeParams(client_id, { code_challenge_method: 'plain' }),
      urls.mcp,
    );
    expect(plain).toMatchObject({ ok: false });
    expect((plain as { redirect: string }).redirect).toContain('error=invalid_request');
    expect((plain as { redirect: string }).redirect).toContain('state=st-1');
    const other = parseAuthorizeRequest(
      authorizeParams(client_id, { resource: 'https://other.example/api/mcp' }),
      urls.mcp,
    );
    expect((other as { redirect: string }).redirect).toContain('error=invalid_target');
    expect(parseAuthorizeRequest(authorizeParams(client_id), urls.mcp).ok).toBe(true);
  });
});

describe('同意 → トークン → 入れ替え → 外す', () => {
  it('コードは1回だけ・PKCE が合うときだけ。トークンで MCP を読め、外すとすぐ読めない', async () => {
    const { client_id } = register();
    const client = readClient(client_id)!;
    const { back, code } = await codeFor(client_id);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('iss')).toBe(urls.issuer);
    // 同意しただけでは読めない(交換するまで)
    expect(grantsOf(s.metadata)).toHaveLength(1);
    expect(await listGrants(admin, 'me')).toEqual([]);

    await expect(
      exchangeCode(admin, { client, code, redirectUri: REDIRECT, codeVerifier: 'x'.repeat(64) }),
    ).rejects.toThrow(/PKCE/);
    const tokens = OAuthTokensSchema.parse(
      await exchangeCode(admin, { client, code, redirectUri: REDIRECT, codeVerifier: verifier }),
    );
    expect(tokens.token_type).toBe('Bearer');
    await expect(
      exchangeCode(admin, { client, code, redirectUri: REDIRECT, codeVerifier: verifier }),
    ).rejects.toThrow(/もう使われた/);

    expect(await verifyAccessToken(admin, tokens.access_token, urls.mcp)).toMatchObject({
      id: 'me',
    });
    expect(
      await verifyAccessToken(admin, tokens.access_token, 'https://other.example/api/mcp'),
    ).toBeNull();
    expect(await verifyAccessToken(admin, `${tokens.access_token}x`, urls.mcp)).toBeNull();
    expect((await listGrants(admin, 'me')).map((g) => g.clientName)).toEqual(['ChatGPT']);

    // 入れ替えると、古いリフレッシュトークンは使えない
    const next = await refreshTokens(admin, {
      client,
      refreshToken: tokens.refresh_token!,
      resource: urls.mcp,
    });
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    await expect(
      refreshTokens(admin, { client, refreshToken: tokens.refresh_token!, resource: urls.mcp }),
    ).rejects.toThrow(/古い/);
    // 別のアプリはそのリフレッシュトークンを使えない
    const other = readClient(register({ client_name: 'Other' }).client_id)!;
    await expect(
      refreshTokens(admin, { client: other, refreshToken: next.refresh_token, resource: urls.mcp }),
    ).rejects.toThrow();

    const [grant] = await listGrants(admin, 'me');
    await revokeGrant(admin, 'me', grant!.id);
    expect(await verifyAccessToken(admin, next.access_token, urls.mcp)).toBeNull();
    await expect(
      refreshTokens(admin, { client, refreshToken: next.refresh_token, resource: urls.mcp }),
    ).rejects.toThrow();
  });

  it('コードは5分で切れる。持ち主でなければ同意できない', async () => {
    const { client_id } = register();
    const client = readClient(client_id)!;
    vi.useFakeTimers();
    try {
      const { code } = await codeFor(client_id);
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await expect(
        exchangeCode(admin, { client, code, redirectUri: REDIRECT, codeVerifier: verifier }),
      ).rejects.toThrow(/期限/);
    } finally {
      vi.useRealTimers();
    }
    const parsed = parseAuthorizeRequest(authorizeParams(client_id), urls.mcp);
    if (!parsed.ok) throw new Error('parse');
    await expect(
      approveAuthorization(admin, 'someone', parsed.request, urls.issuer),
    ).rejects.toThrow();
  });

  it('同じアプリをつなぎ直したら、前のつながりは外れる。鍵(個人用)は消さない', async () => {
    const { client_id } = register();
    await codeFor(client_id);
    await codeFor(client_id);
    expect(grantsOf(s.metadata)).toHaveLength(1);
    expect(s.metadata.mcp_tokens).toEqual([]);
  });
});

describe('ログインのあとの戻り先', () => {
  it('カメラと同意画面だけ。外のサイトや別の画面へは戻さない', () => {
    expect(safeLoginNext('/camera')).toBe('/camera');
    expect(safeLoginNext('/oauth/authorize?client_id=x&state=y')).toBe(
      '/oauth/authorize?client_id=x&state=y',
    );
    expect(safeLoginNext('https://evil.example')).toBeNull();
    expect(safeLoginNext('//evil.example/oauth/authorize?x')).toBeNull();
    expect(safeLoginNext('/oauth/authorize\\@evil')).toBeNull();
    expect(safeLoginNext('/settings')).toBeNull();
    expect(safeLoginNext(null)).toBeNull();
  });
});

describe('入口の守り', () => {
  it('同意画面はログインが要り(関所の対象)、枠の中に出させない。案内・登録・トークンは関所の外', () => {
    const proxy = readFileSync('proxy.ts', 'utf8');
    const matcher = proxy.slice(proxy.indexOf('matcher'));
    expect(matcher).toContain('api/oauth');
    expect(matcher).toContain('.well-known');
    expect(matcher).not.toMatch(/[|(]oauth\/authorize/);
    const config = readFileSync('next.config.ts', 'utf8');
    expect(config).toContain("source: '/oauth/authorize'");
    expect(config).toContain("frame-ancestors 'none'");
  });
});
