/**
 * AI とつなぐ(MCP)の道具を並べて呼んだとき(ADR-145)。入口(/api/mcp)・OAuth と鍵の確かめ・本人として
 * 動く(runAsOwner)は本物で、Supabase Auth だけ偽物(発行するたびに前のリンクを消す、本物と同じ決まり)。
 *
 * 以前は道具を呼ぶたびにマジックリンクを発行していたので、並ぶと前のほうが「本人として読めませんでした:
 * Email link is invalid or has expired」で失敗していた。
 */
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeGoTrue, type FakeGoTrue } from '../helpers/fake-gotrue';

vi.mock('server-only', () => ({}));

const s = vi.hoisted(() => {
  const state = {
    gotrue: null as unknown as FakeGoTrue,
    metadata: {} as Record<string, unknown>,
    cookies: vi.fn(),
    calls: [] as string[],
    /** 道具の中身の代わり:そのとき createClient() が返すセッションの人と、渡された引数を返す。 */
    probe:
      (tool: string) =>
      async (...args: unknown[]) => {
        const { createClient } = await import('@/lib/supabase/server');
        const client = (await createClient()) as unknown as {
          auth?: {
            getSession: () => Promise<{ data: { session: { user: { id: string } } | null } }>;
          };
        };
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
        const session = client.auth ? (await client.auth.getSession()).data.session : null;
        state.calls.push(tool);
        return { tool, args, user: session?.user.id ?? null };
      },
  };
  return state;
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.gotrue.createClient() }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    s.cookies();
    return { getAll: () => [], set: () => {} };
  },
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ marker: 'cookie' }) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        generateLink: (input: { type: string; email: string }) =>
          s.gotrue.admin.auth.admin.generateLink(input),
        getUserById: async () => ({ data: { user: { app_metadata: s.metadata } }, error: null }),
        updateUserById: async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
          s.metadata = structuredClone(attrs.app_metadata);
          return { data: {}, error: null };
        },
      },
    },
  }),
}));
vi.mock('@/lib/supabase/owner', () => ({
  findOwner: async () => ({
    user: { id: 'me', email: 'me@example.com', created_at: '' },
    error: null,
  }),
}));

vi.mock('@/features/mcp/data', async (original) => ({
  ...(await original<typeof import('@/features/mcp/data')>()),
  todayData: s.probe('get_today'),
  categoryData: s.probe('get_categories'),
  monthData: s.probe('get_month_summary'),
  searchData: s.probe('search_transactions'),
  upcomingData: s.probe('get_upcoming'),
  needsCheckData: s.probe('get_needs_check'),
}));
vi.mock('@/features/mcp/write', async (original) => ({
  ...(await original<typeof import('@/features/mcp/write')>()),
  addRecord: s.probe('add_record'),
}));

import {
  exchangeCode,
  oauthUrls,
  parseAuthorizeRequest,
  approveAuthorization,
  registerClient,
  revokeGrant,
  grantsOf,
} from '@/features/mcp/oauth';
import { issueMcpToken, revokeMcpToken, storedTokensOf } from '@/features/mcp/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import { forgetOwnerSessionsForTest } from '@/lib/supabase/owner-session';

import { POST } from '../../app/api/mcp/route';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-0123456789';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-anon-key-anon-key';

const urls = oauthUrls('https://kakeibo.example');
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'v'.repeat(64);

/** ChatGPT がつなぐのと同じ手順で、アクセストークンをもらう。 */
async function oauthToken(): Promise<string> {
  const registered = registerClient({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] });
  if (!registered.ok) throw new Error('register');
  const clientId = (registered.body as { client_id: string }).client_id;
  const parsed = parseAuthorizeRequest(
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'st',
      resource: urls.mcp,
    }),
    urls.mcp,
  );
  if (!parsed.ok) throw new Error('authorize');
  const admin = createAdminClient();
  const back = new URL(await approveAuthorization(admin, 'me', parsed.request, urls.issuer));
  const tokens = await exchangeCode(admin, {
    client: parsed.request.client,
    code: back.searchParams.get('code')!,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
  });
  return tokens.access_token;
}

let rpcId = 0;
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  rpcId += 1;
  const response = await POST(
    new Request(urls.mcp, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  if (response.status !== 200) return { status: response.status, isError: true, data: null };
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  const text = body.result.content[0]!.text;
  return {
    status: 200,
    isError: body.result.isError === true,
    text,
    data: body.result.isError
      ? null
      : (JSON.parse(text) as { tool: string; args: unknown[]; user: string | null }),
  };
}

beforeEach(() => {
  s.gotrue = createFakeGoTrue();
  s.metadata = { mcp_tokens: [] };
  s.calls = [];
  s.cookies.mockClear();
  forgetOwnerSessionsForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP の道具を並べて呼ぶ', () => {
  it('同じ道具を10回同時に呼んでも、全部が本人のセッションで読める', async () => {
    const token = await oauthToken();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => callTool(token, 'get_today')),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.text ?? '').not.toContain('Email link is invalid or has expired');
      expect(r.data).toMatchObject({ tool: 'get_today', args: ['me'], user: 'me' });
    }
    expect(s.gotrue.state.generated).toBe(1);
    expect(s.cookies).not.toHaveBeenCalled();
  });

  it('違う道具を10回同時に(OAuth と個人用の鍵をまぜて)呼んでも、引数も人も混ざらない', async () => {
    const access = await oauthToken();
    const { token: personal } = await issueMcpToken(createAdminClient(), 'me', 'Claude Code');
    const addInput = { type: 'expense', amountYen: 1200, store: 'ランチ', category: '外食' };
    // [道具, 引数, 道具の中身に渡るはずの引数]
    const requests: [string, Record<string, unknown>, unknown[]][] = [
      ['get_today', {}, ['me']],
      ['get_categories', { category: '外食' }, ['外食']],
      ['get_month_summary', { month: '2026-09' }, ['2026-09']],
      ['search_transactions', { query: 'ファミリーマート' }, [{ query: 'ファミリーマート' }]],
      ['search_transactions', { query: 'セブン-イレブン' }, [{ query: 'セブン-イレブン' }]],
      ['get_upcoming', { days: 14 }, [14]],
      ['get_needs_check', {}, ['me']],
      ['get_categories', { category: 'カフェ' }, ['カフェ']],
      ['get_month_summary', { month: '2026-10' }, ['2026-10']],
      ['add_record', addInput, [addInput]],
    ];
    const results = await Promise.all(
      requests.map(([name, args], i) => callTool(i % 2 ? personal : access, name, args)),
    );
    results.forEach((r, i) => {
      const [name, , expected] = requests[i]!;
      expect(r.status, name).toBe(200);
      expect(r.isError, `${name}: ${r.text}`).toBe(false);
      expect(r.data).toEqual({ tool: name, args: expected, user: 'me' });
    });
    expect(s.calls).toHaveLength(10);
    expect(s.gotrue.state.generated).toBe(1);
  });

  it('続けて何度呼んでも(別のリクエストで同じ人)、セッションは1つのまま', async () => {
    const token = await oauthToken();
    for (let i = 0; i < 5; i += 1) {
      const r = await callTool(token, 'search_transactions', { query: `店${i}` });
      expect(r.data).toMatchObject({ user: 'me', args: [{ query: `店${i}` }] });
    }
    expect(s.gotrue.state.generated).toBe(1);
  });

  it('期限切れのトークン・外したつながり・取り消した鍵では、何も読まず、セッションも作らない', async () => {
    const token = await oauthToken();
    const { token: personal, view } = await issueMcpToken(createAdminClient(), 'me', 'k');

    const later = Date.now() + 2 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect((await callTool(token, 'get_today')).status).toBe(401);
    vi.restoreAllMocks();

    const [grant] = grantsOf(s.metadata);
    await revokeGrant(createAdminClient(), 'me', grant!.id);
    await revokeMcpToken(createAdminClient(), 'me', view.id);
    expect(storedTokensOf(s.metadata)).toEqual([]);
    const after = await Promise.all([
      callTool(token, 'get_today'),
      callTool(personal, 'get_today'),
      callTool(`${token.slice(0, -2)}xx`, 'get_today'),
    ]);
    expect(after.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(s.calls).toEqual([]);
    expect(s.gotrue.state.generated).toBe(0);
  });
});
