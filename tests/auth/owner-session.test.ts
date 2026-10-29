import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeGoTrue, type FakeGoTrue } from '../helpers/fake-gotrue';

const s = vi.hoisted(() => ({
  gotrue: null as unknown as FakeGoTrue,
  cookies: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.gotrue.createClient() }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    s.cookies();
    return { getAll: () => [], set: () => {} };
  },
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ marker: 'cookie' }) }));

import {
  forgetOwnerSessionsForTest,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  setAcceptWaitsForTest,
  ownerSessionClient,
  runAsOwner,
} from '@/lib/supabase/owner-session';
import { runWithSessionClient, sessionOverrideClient } from '@/lib/supabase/session-override';
import { createClient } from '@/lib/supabase/server';

/**
 * LINE の受信・AI とつなぐ(MCP)など、送り主を確かめた経路で本人として動く(ADR-130・145)。
 * 管理クライアントより狭い(本人の行だけ)セッションを、本人ごとに1つ作って使い回す。
 *
 * Supabase Auth は発行するたびに前のリンクを消すので、呼ぶたびに発行していたころは、MCP の道具が
 * 並ぶと前のほうが「Email link is invalid or has expired」で失敗していた(ADR-145)。
 */

const owner = { id: 'me', email: 'me@example.com', created_at: '' };
const other = { id: 'you', email: 'you@example.com', created_at: '' };
const admin = () => s.gotrue.admin as never;

type AuthLike = {
  auth: { getSession: () => Promise<{ data: { session: { user: { id: string } } | null } }> };
};

/** その時点で、本人として動いているクライアントと、そのセッションの人。 */
async function whoAmI() {
  const client = ownerSessionClient() as unknown as AuthLike | undefined;
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  return { client, userId: data.session?.user.id };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-anon-key-anon-key';
  s.gotrue = createFakeGoTrue({ 'me@example.com': 'me', 'you@example.com': 'you' });
  forgetOwnerSessionsForTest();
  setAcceptWaitsForTest([1, 1, 1]);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('偽の Supabase Auth は本物と同じ決まり', () => {
  it('発行するたびに前のリンクは使えなくなる(以前の失敗の元)', async () => {
    const first = await s.gotrue.generateLink({ type: 'magiclink', email: owner.email });
    await s.gotrue.generateLink({ type: 'magiclink', email: owner.email });
    const { error } = (await s.gotrue
      .createClient()
      .auth.verifyOtp({ type: 'magiclink', token_hash: first.data.properties!.hashed_token })) as {
      error: { message: string } | null;
    };
    expect(error?.message).toBe('Email link is invalid or has expired');
  });
});

describe('本人として動く', () => {
  it('その間だけ createClient() が本人のセッションを返し(cookie を読まない)、外ではふだんどおり', async () => {
    const seen = await runAsOwner(admin(), owner, async () => ({
      ...(await whoAmI()),
      created: await createClient(),
    }));
    expect(s.gotrue.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'me@example.com',
    });
    expect(seen.userId).toBe('me');
    expect(seen.created).toBe(seen.client);
    expect(s.cookies).not.toHaveBeenCalled();
    expect(ownerSessionClient()).toBeUndefined();
    expect(await createClient()).toEqual({ marker: 'cookie' });
  });

  it('同じ道具を10個並べて呼んでも、リンクは1回だけ発行し、全部が本人のセッションで動く', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runAsOwner(admin(), owner, whoAmI)),
    );
    expect(results.map((r) => r.userId)).toEqual(Array(10).fill('me'));
    expect(new Set(results.map((r) => r.client)).size).toBe(1);
    expect(s.gotrue.state.generated).toBe(1);
    expect(s.gotrue.state.verified).toBe(1);
  });

  it('違う道具(待ち時間も失敗もばらばら)を10個並べても混ざらず、外には漏れない', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        runAsOwner(admin(), owner, async () => {
          await new Promise((r) => setTimeout(r, (i * 7) % 5));
          if (i === 3) throw new Error('道具の中の失敗');
          const after = await whoAmI();
          return { i, userId: after.userId };
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') expect(r.value).toEqual({ i, userId: 'me' });
    }
    expect(s.gotrue.state.generated).toBe(1);
    expect(ownerSessionClient()).toBeUndefined();
    // 道具が失敗しても、セッションは次も使える(作り直さない)
    expect((await runAsOwner(admin(), owner, whoAmI)).userId).toBe('me');
    expect(s.gotrue.state.generated).toBe(1);
  });

  it('別々のサーバーが同時に作ってぶつかっても、作り直して全部通る', async () => {
    const instances = [];
    for (let i = 0; i < 3; i += 1) {
      vi.resetModules();
      const ownerSession = await import('@/lib/supabase/owner-session');
      instances.push(ownerSession);
    }
    const results = await Promise.all(
      instances.flatMap((inst) =>
        Array.from({ length: 4 }, () =>
          inst.runAsOwner(admin(), owner, async () => {
            const client = inst.ownerSessionClient() as unknown as AuthLike;
            return (await client.auth.getSession()).data.session?.user.id;
          }),
        ),
      ),
    );
    expect(results).toEqual(Array(12).fill('me'));
    // サーバーごとに1つずつ(ぶつかった分だけ発行が増える)
    expect(s.gotrue.state.verified).toBe(3);
    expect(s.gotrue.state.generated).toBeGreaterThan(3);
  });

  it('ぶつかり続けたら、決まった回数で止めて覚えず、次の呼び出しでまた作る', async () => {
    s.gotrue.state.alwaysOverwritten = true;
    const fn = vi.fn();
    await expect(runAsOwner(admin(), owner, fn)).rejects.toThrow(
      '本人として読めませんでした: Email link is invalid or has expired',
    );
    expect(s.gotrue.state.generated).toBe(MAX_ATTEMPTS);
    expect(fn).not.toHaveBeenCalled();
    s.gotrue.state.alwaysOverwritten = false;
    expect((await runAsOwner(admin(), owner, whoAmI)).userId).toBe('me');
  });

  it('セッションが切れていたら(取り消し・リフレッシュの失敗)、作り直す', async () => {
    const first = await runAsOwner(admin(), owner, whoAmI);
    first.client!.auth.getSession = async () => ({ data: { session: null } });
    const second = await runAsOwner(admin(), owner, whoAmI);
    expect(second.userId).toBe('me');
    expect(second.client).not.toBe(first.client);
    expect(s.gotrue.state.generated).toBe(2);
  });

  it('古くなったら新しくし、前のは使っている処理が終わってから無効にする', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const hold = deferred();
    const long = runAsOwner(admin(), owner, async () => {
      const before = await whoAmI();
      await hold.promise;
      return { before, after: await whoAmI() };
    });
    await new Promise((r) => setTimeout(r, 10));
    const [oldClient] = s.gotrue.state.clients;

    clock.mockReturnValue(now + MAX_AGE_MS + 1);
    const fresh = await runAsOwner(admin(), owner, whoAmI);
    expect(fresh.client).not.toBe(oldClient);
    expect(s.gotrue.state.signedOut).toBe(0); // まだ使っている

    hold.resolve();
    const { before, after } = await long;
    expect(before.client).toBe(oldClient);
    expect(after.userId).toBe('me');
    expect(s.gotrue.state.signedOut).toBe(1);
    expect(oldClient!.session?.alive).toBe(false);
    expect(fresh.client).toBe(s.gotrue.state.clients[1]);
  });

  it('本人ごとに別のセッションで、ほかの人のセッションは使わない', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runAsOwner(admin(), i % 2 ? other : owner, async () => (await whoAmI()).userId),
      ),
    );
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => (i % 2 ? 'you' : 'me')));
    expect(s.gotrue.state.generated).toBe(2);
  });

  it('確かめた人が本人でなければ、何もせずに止め、そのセッションは無効にする', async () => {
    s.gotrue.state.verifyAs = 'someone';
    const fn = vi.fn();
    await expect(runAsOwner(admin(), owner, fn)).rejects.toThrow('本人として読めませんでした');
    expect(fn).not.toHaveBeenCalled();
    expect(s.gotrue.state.signedOut).toBe(1);
    expect(s.gotrue.state.generated).toBe(1); // 作り直さない
  });

  it('発行そのものの失敗は作り直さずに止め、覚えない', async () => {
    s.gotrue.state.generateError = 'User not found';
    const fn = vi.fn();
    await expect(runAsOwner(admin(), owner, fn)).rejects.toThrow(
      '本人として読めませんでした: User not found',
    );
    expect(s.gotrue.state.generated).toBe(1);
    expect(fn).not.toHaveBeenCalled();
    s.gotrue.state.generateError = null;
    expect((await runAsOwner(admin(), owner, whoAmI)).userId).toBe('me');
  });

  it('メールアドレスが無ければ止める', async () => {
    await expect(runAsOwner(admin(), { id: 'me', created_at: '' }, vi.fn())).rejects.toThrow(
      '本人のメールアドレスが分かりません',
    );
  });
});

describe('データベースの時計が遅れているとき(JWT issued at future、ADR-145 追補)', () => {
  it('作ったばかりのトークンが受け付けられるまで待ってから使う(道具は1回だけ動く)', async () => {
    s.gotrue.state.futureRejects = 2;
    const fn = vi.fn(whoAmI);
    expect((await runAsOwner(admin(), owner, fn)).userId).toBe('me');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.gotrue.state.queries).toBe(3);
    // 使い回すときは確かめ直さない
    await runAsOwner(admin(), owner, whoAmI);
    expect(s.gotrue.state.queries).toBe(3);
  });

  it('待っても受け付けられなければ、そのセッションは無効にして止め、次の呼び出しで作り直す', async () => {
    s.gotrue.state.futureRejects = 10;
    const fn = vi.fn();
    await expect(runAsOwner(admin(), owner, fn)).rejects.toThrow(/JWT issued at future/);
    expect(fn).not.toHaveBeenCalled();
    expect(s.gotrue.state.signedOut).toBe(1);
    s.gotrue.state.futureRejects = 0;
    expect((await runAsOwner(admin(), owner, whoAmI)).userId).toBe('me');
    expect(s.gotrue.state.generated).toBe(2);
  });
});

describe('処理ごとのクライアント(session-override)', () => {
  it('並んで動く処理どうしで、渡したクライアントが混ざらない', async () => {
    const a = { name: 'a' } as never;
    const b = { name: 'b' } as never;
    const seen = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runWithSessionClient(i % 2 ? b : a, async () => {
          await new Promise((r) => setTimeout(r, (i * 3) % 4));
          return sessionOverrideClient();
        }),
      ),
    );
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => (i % 2 ? b : a)));
    expect(sessionOverrideClient()).toBeUndefined();
  });
});
