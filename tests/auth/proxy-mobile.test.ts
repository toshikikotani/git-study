import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: s.getUser } }),
}));

import { proxy } from '../../proxy';

/**
 * 関所(proxy.ts)は、iPhone アプリの入口(/api/mobile/*)だけ、アプリが送るトークンで本人を確かめる
 * (ADR-132)。ほかの道は、いままでどおり cookie のセッション。
 */

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://example.com${path}`, { headers });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-anon-key-anon-key';
  s.getUser.mockImplementation(async (jwt?: string) => ({
    data: { user: jwt === 'good.token.x' ? { id: 'me' } : null },
  }));
});

describe('iPhone アプリの入口', () => {
  it('トークンを Supabase で確かめて通す。確かめられなければ 401', async () => {
    const ok = await proxy(req('/api/mobile/today', { authorization: 'Bearer good.token.x' }));
    expect(ok.status).toBe(200);
    expect(s.getUser).toHaveBeenCalledWith('good.token.x');

    const bad = await proxy(req('/api/mobile/today', { authorization: 'Bearer bad.token.x' }));
    expect(bad.status).toBe(401);
    const none = await proxy(req('/api/mobile/today'));
    expect(none.status).toBe(401);
  });

  it('ほかの API にトークンを付けても cookie で確かめる(トークンでは通さない)', async () => {
    const res = await proxy(req('/api/assistant/chat', { authorization: 'Bearer good.token.x' }));
    expect(s.getUser).toHaveBeenCalledWith();
    expect(res.status).toBe(401);
  });

  it('画面は、いままでどおり未ログインならログインへ', async () => {
    const res = await proxy(req('/spending', { authorization: 'Bearer good.token.x' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
