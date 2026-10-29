/**
 * LINE の受信・AI とつなぐ(MCP)など、本人のセッション(cookie)が無いサーバーどうしの経路で、本人
 * (オーナー)としてアプリの読み書きをする(v4-2「LINEで完結」ADR-130、MCP ADR-142〜145)。
 *
 * AIの窓口・今日の目安・もし使ったら・MCP の道具は、本人のセッションの Supabase クライアント(RLS で本人の
 * 行だけ)を前提に組んである。これらを同じ計算で使うため、この中で動く間だけ `createClient()`(server.ts)が、
 * 本人として発行したセッションのクライアントを返す。
 *
 *   - 呼べるのは、送り主を確かめた経路だけ(LINE の署名と LINE_USER_ID、MCP の鍵・OAuth のトークン)。
 *   - 管理クライアント(RLS を越える)より狭い:本人の行しか見えない・書けない(RLS のまま)。
 *   - 新しいログインの方法ではない(本人がこの経路でログインすることはできない)。
 *
 * ── セッションの作り方と使い回し(ADR-145)─────────────────────────────
 * セッションは、管理 API でマジックリンクを発行し(generateLink)、そのハッシュを確かめて(verifyOtp)作る。
 * Supabase Auth は、マジックリンクを発行するたびに、その人の前のリンク(recovery_token)を消す
 * (CreateOneTimeToken → ClearOneTimeTokenForUser)。以前は呼ばれるたびに発行していたので、MCP の道具が
 * 並んで呼ばれると、あとの発行が前のリンクを消し、前のほうの確かめが「Email link is invalid or has expired」
 * で失敗していた。そこで:
 *   - 1つのサーバーの中では、本人ごとにセッションを1つだけ作り(作っている途中なら、それを待つ)、
 *     しばらく使い回す(MAX_AGE_MS)。使う前に、まだ生きているかを確かめる(期限が近ければ auth-js が
 *     その場で入れ替える)。
 *   - 別々のサーバー(Vercel の複数のインスタンス)が同時に作るときは、まだ消し合うことがあるので、
 *     その失敗のときだけ、少し待って作り直す(MAX_ATTEMPTS 回まで)。
 *   - 古くなったセッションは、使っている途中の処理が終わってから無効にする(signOut、そのセッションだけ)。
 * セッションのクライアントはこのサーバーの記憶の中だけにあり、外へは出さない。どの処理が使えるかは、
 * AsyncLocalStorage(session-override.ts)で、その処理の間だけに限る。
 *
 * server.ts(next/headers を使うのでサーバーでしか動かない)からだけ読む。管理クライアントの型だけを使い、
 * 管理キーそのものはここで読まない。
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { getPublicEnv } from '@/lib/env';
import type { createAdminClient } from './admin';
import type { OwnerUser } from './owner';
import { runWithSessionClient, sessionOverrideClient } from './session-override';
import type { Database } from './types';

/** 本人として動いている間の Supabase クライアント(それ以外は undefined)。 */
export const ownerSessionClient = sessionOverrideClient;

export class OwnerSessionError extends Error {}

type Admin = ReturnType<typeof createAdminClient>;

/** 使い回す長さ。アクセストークン(既定 1時間)が切れる前に新しくする。 */
export const MAX_AGE_MS = 50 * 60 * 1000;
/** 別のサーバーと発行がぶつかったときに作り直す回数。 */
export const MAX_ATTEMPTS = 5;

type LiveSession = {
  client: SupabaseClient<Database>;
  createdAt: number;
  /** いま使っている処理の数。 */
  inFlight: number;
  /** 新しいものに替えた(使い終わったら無効にする)。 */
  retired: boolean;
};

/** 本人ごとの、いまのセッション(作っている途中も含む)。 */
const live = new Map<string, Promise<LiveSession>>();

/** 発行がぶつかって前のリンクが消されたときの失敗(作り直せば通る)。 */
export function isLinkRace(
  error: {
    message?: string | undefined;
    code?: string | undefined;
    status?: number | undefined;
  } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === 'otp_expired' ||
    error.code === 'over_request_rate_limit' ||
    error.status === 429 ||
    /invalid or has expired/i.test(error.message ?? '')
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** マジックリンクで本人のセッションを1つ作る(ぶつかったら少し待って作り直す)。 */
async function createOwnerSession(admin: Admin, owner: OwnerUser): Promise<LiveSession> {
  if (!owner.email) throw new OwnerSessionError('本人のメールアドレスが分かりません');
  const env = getPublicEnv();
  let lastMessage = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: owner.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      lastMessage = linkError?.message ?? '';
      if (attempt < MAX_ATTEMPTS && isLinkRace(linkError)) {
        await sleep(jitter(attempt));
        continue;
      }
      throw new OwnerSessionError(`本人として読めませんでした: ${lastMessage}`);
    }

    const client = createSupabaseClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { data: verified, error: verifyError } = await client.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (!verifyError && verified.user?.id === owner.id) {
      return { client, createdAt: Date.now(), inFlight: 0, retired: false };
    }
    if (!verifyError) {
      // 別の人のセッションになった。使わずに無効にして止める。
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      throw new OwnerSessionError('本人として読めませんでした: 本人ではありません');
    }
    lastMessage = verifyError.message ?? '';
    if (attempt < MAX_ATTEMPTS && isLinkRace(verifyError)) {
      await sleep(jitter(attempt));
      continue;
    }
    break;
  }
  throw new OwnerSessionError(`本人として読めませんでした: ${lastMessage}`);
}

/** 待つ長さ(回を重ねるほど長く、サーバーどうしで同じにならないようばらつかせる)。 */
function jitter(attempt: number): number {
  return Math.round((80 + Math.random() * 220) * attempt);
}

/** 使い終わって、替えられていたら無効にする。 */
function release(session: LiveSession): void {
  session.inFlight -= 1;
  if (session.retired && session.inFlight === 0) {
    void session.client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}

/** 替える。いま使っている処理が無ければ、その場で無効にする。 */
function retire(ownerId: string, pending: Promise<LiveSession>, session: LiveSession): void {
  if (live.get(ownerId) === pending) live.delete(ownerId);
  if (session.retired) return;
  session.retired = true;
  if (session.inFlight === 0) void session.client.auth.signOut({ scope: 'local' }).catch(() => {});
}

/** 本人の、いま使えるセッション(無ければ1つだけ作る)。使う処理の数を1つ増やして返す。 */
async function acquire(admin: Admin, owner: OwnerUser): Promise<LiveSession> {
  for (let round = 0; round < 2; round += 1) {
    let pending = live.get(owner.id);
    if (!pending) {
      const created = createOwnerSession(admin, owner);
      live.set(owner.id, created);
      created.catch(() => {
        if (live.get(owner.id) === created) live.delete(owner.id);
      });
      pending = created;
    }
    const session = await pending;
    if (Date.now() - session.createdAt > MAX_AGE_MS) {
      retire(owner.id, pending, session);
      continue;
    }
    // まだ生きているか(期限が近ければ auth-js がその場で入れ替える。同じクライアントの中では1回にまとまる)。
    session.inFlight += 1;
    const { data } = await session.client.auth.getSession();
    if (data.session && data.session.user.id === owner.id) return session;
    session.inFlight -= 1;
    retire(owner.id, pending, session);
  }
  throw new OwnerSessionError('本人として読めませんでした: セッションを作れませんでした');
}

/** `fn` を本人(オーナー)のセッションで動かす。 */
export async function runAsOwner<T>(
  admin: Admin,
  owner: OwnerUser,
  fn: () => Promise<T>,
): Promise<T> {
  const session = await acquire(admin, owner);
  try {
    return await runWithSessionClient(session.client, fn);
  } finally {
    release(session);
  }
}

/** テスト用:覚えているセッションを忘れる(別のサーバーが立ち上がったのと同じ状態にする)。 */
export function forgetOwnerSessionsForTest(): void {
  live.clear();
}
