import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  setSession: vi.fn(),
  signOut: vi.fn(),
  cookies: vi.fn(),
  client: null as unknown,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    s.client = { auth: { setSession: s.setSession, signOut: s.signOut }, marker: 'bearer' };
    return s.client;
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => {
    s.cookies();
    return { getAll: () => [], set: () => {} };
  },
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ marker: 'cookie' }) }));

import { bearerTokenOf } from '@/lib/bearer-token';
import { isExpiringToken, withMobileSession } from '@/lib/supabase/bearer-session';
import { createClient } from '@/lib/supabase/server';

/**
 * iPhone アプリの入口(ADR-132):アプリが送るアクセストークンを確かめ、その処理のあいだだけ本人の
 * セッション(RLS のまま)で動く。Web の cookie のセッションには触らない。
 */

const jwt = (exp: number) =>
  [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'me', exp })).toString('base64url'),
    'signature',
  ].join('.');
const now = () => Math.floor(Date.now() / 1000);
const call = (headers: Record<string, string> = {}) =>
  new Request('https://example.com/api/mobile/today', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-anon-key-anon-key';
  s.setSession.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
});

describe('アプリが送るトークン', () => {
  it('Authorization: Bearer のトークンだけを読む', () => {
    expect(bearerTokenOf(call({ authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
    expect(bearerTokenOf(call({ authorization: 'Basic abc' }))).toBeNull();
    expect(bearerTokenOf(call({ authorization: 'Bearer a b' }))).toBeNull();
    expect(bearerTokenOf(call())).toBeNull();
  });

  it('期限が切れている・近い・読めないトークンは受け付けない(リフレッシュはしない)', () => {
    expect(isExpiringToken(jwt(now() + 600))).toBe(false);
    expect(isExpiringToken(jwt(now() + 10))).toBe(true);
    expect(isExpiringToken(jwt(now() - 10))).toBe(true);
    expect(isExpiringToken('not-a-jwt')).toBe(true);
  });
});

describe('本人のセッションとして動く', () => {
  it('トークンを確かめてから、その間だけ createClient() が本人のセッションを返す(cookie を読まない・ログアウトしない)', async () => {
    const token = jwt(now() + 600);
    const handler = withMobileSession(async (_request, ctx) =>
      Response.json({ userId: ctx.userId, same: (await createClient()) === s.client }),
    );
    const res = await handler(call({ authorization: `Bearer ${token}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'me', same: true });
    expect(s.setSession).toHaveBeenCalledWith({
      access_token: token,
      refresh_token: expect.any(String),
    });
    expect(s.cookies).not.toHaveBeenCalled();
    expect(s.signOut).not.toHaveBeenCalled();
    // 外では、ふだんどおり cookie のセッション
    expect(await createClient()).toEqual({ marker: 'cookie' });
  });

  it('トークンが無い・期限切れ・Supabase が本人と認めないなら 401(中身は動かさない)', async () => {
    const inner = vi.fn(async () => Response.json({}));
    const handler = withMobileSession(inner);
    expect((await handler(call())).status).toBe(401);
    expect((await handler(call({ authorization: `Bearer ${jwt(now() - 60)}` }))).status).toBe(401);
    expect(s.setSession).not.toHaveBeenCalled();
    s.setSession.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    expect((await handler(call({ authorization: `Bearer ${jwt(now() + 600)}` }))).status).toBe(401);
    s.setSession.mockRejectedValue(new Error('network'));
    expect((await handler(call({ authorization: `Bearer ${jwt(now() + 600)}` }))).status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });
});
