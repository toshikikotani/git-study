import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  verify: vi.fn(),
  signOut: vi.fn(),
  cookies: vi.fn(),
  client: null as unknown,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    s.client = { auth: { verifyOtp: s.verify, signOut: s.signOut }, marker: 'owner' };
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

import { ownerSessionClient, runAsOwner } from '@/lib/supabase/owner-session';
import { createClient } from '@/lib/supabase/server';

/**
 * LINE の受信など、送り主を確かめた経路で本人として動く(ADR-130)。管理クライアントより狭い
 * (本人の行だけ)セッションを、この処理のためだけに作って、終わったら無効にする。
 */

const owner = { id: 'me', email: 'me@example.com', created_at: '' };
const admin = (hashed: string | null) =>
  ({
    auth: {
      admin: {
        generateLink: vi.fn(async () => ({
          data: { properties: hashed ? { hashed_token: hashed } : {} },
          error: hashed ? null : { message: 'no' },
        })),
      },
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-anon-key-anon-key';
  s.verify.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
  s.signOut.mockResolvedValue({ error: null });
});

describe('本人として動く', () => {
  it('その間だけ createClient() が本人のセッションを返し(cookie を読まない)、終わったら無効にする', async () => {
    const seen = await runAsOwner(admin('hash'), owner, async () => ({
      inside: ownerSessionClient(),
      created: await createClient(),
    }));
    expect(s.verify).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'hash' });
    expect(seen.created).toBe(s.client);
    expect(seen.inside).toBe(s.client);
    expect(s.cookies).not.toHaveBeenCalled();
    expect(s.signOut).toHaveBeenCalledWith({ scope: 'local' });
    // 外では、ふだんどおり cookie のセッション
    expect(ownerSessionClient()).toBeUndefined();
    expect(await createClient()).toEqual({ marker: 'cookie' });
  });

  it('本人でなかったら、何もせずに止める', async () => {
    s.verify.mockResolvedValue({ data: { user: { id: 'someone' } }, error: null });
    const fn = vi.fn();
    await expect(runAsOwner(admin('hash'), owner, fn)).rejects.toThrow(
      '本人として読めませんでした',
    );
    expect(fn).not.toHaveBeenCalled();
    await expect(runAsOwner(admin(null), owner, fn)).rejects.toThrow('本人として読めませんでした');
    expect(fn).not.toHaveBeenCalled();
  });

  it('途中で失敗しても、セッションは無効にする', async () => {
    await expect(
      runAsOwner(admin('hash'), owner, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(s.signOut).toHaveBeenCalled();
  });
});
