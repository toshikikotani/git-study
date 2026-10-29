/**
 * Supabase Auth(GoTrue)のマジックリンクの、本人として動く(runAsOwner)に関わるところだけの偽物。
 *
 * 本物と同じく、1人につき使えるリンクは最後に発行した1つだけ(発行するたびに、その人の前のリンクを消す:
 * CreateOneTimeToken → ClearOneTimeTokenForUser)。1回確かめたら使えなくなる。前のリンクを確かめると
 * 「Email link is invalid or has expired」(otp_expired)を返す。
 *
 * `@supabase/supabase-js` の createClient を `fakeGoTrue.createClient` に差し替えて使う。
 */
import { vi } from 'vitest';

export type FakeSession = { user: { id: string }; alive: boolean };

export type FakeAuthClient = {
  marker: 'owner';
  session: FakeSession | null;
  auth: {
    verifyOtp: (input: { type: string; token_hash: string }) => Promise<unknown>;
    getSession: () => Promise<{ data: { session: FakeSession | null }; error: null }>;
    signOut: (input: { scope: string }) => Promise<{ error: null }>;
  };
};

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFakeGoTrue(users: Record<string, string> = { 'me@example.com': 'me' }) {
  const links = new Map<string, string>();
  const state = {
    generated: 0,
    verified: 0,
    signedOut: 0,
    clients: [] as FakeAuthClient[],
    /** 確かめるのにかかる時間(この間に別の発行が割り込める)。 */
    verifyMs: 1,
    /** 確かめると、いつも別の人になる(本人でないときの確かめ)。 */
    verifyAs: null as string | null,
    /** 発行がいつも失敗する(ぶつかったのではない失敗)。 */
    generateError: null as string | null,
    /** 発行したリンクを、別のサーバーがすぐ上書きする(いつもぶつかる)。 */
    alwaysOverwritten: false,
  };
  let seq = 0;

  const generateLink = vi.fn(async ({ email }: { type: string; email: string }) => {
    state.generated += 1;
    if (state.generateError) {
      return { data: { properties: null, user: null }, error: { message: state.generateError } };
    }
    seq += 1;
    const hash = `h${seq}`;
    links.set(email, state.alwaysOverwritten ? `${hash}-other` : hash); // 前のリンクは消える
    return { data: { properties: { hashed_token: hash }, user: null }, error: null };
  });

  function createClient(): FakeAuthClient {
    const client: FakeAuthClient = {
      marker: 'owner',
      session: null,
      auth: {
        verifyOtp: async ({ token_hash }) => {
          await tick(state.verifyMs);
          const email = [...links.entries()].find(([, hash]) => hash === token_hash)?.[0];
          if (!email) {
            return {
              data: { user: null, session: null },
              error: {
                message: 'Email link is invalid or has expired',
                code: 'otp_expired',
                status: 403,
              },
            };
          }
          links.delete(email); // 1回だけ
          state.verified += 1;
          const id = state.verifyAs ?? users[email] ?? 'unknown';
          client.session = { user: { id }, alive: true };
          return { data: { user: { id }, session: client.session }, error: null };
        },
        getSession: async () => ({
          data: { session: client.session?.alive ? client.session : null },
          error: null,
        }),
        signOut: async () => {
          state.signedOut += 1;
          if (client.session) client.session.alive = false;
          return { error: null };
        },
      },
    };
    state.clients.push(client);
    return client;
  }

  const admin = { auth: { admin: { generateLink } } };

  return { state, links, generateLink, createClient, admin };
}

export type FakeGoTrue = ReturnType<typeof createFakeGoTrue>;
