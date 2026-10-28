/**
 * AI とつなぐ(MCP)ための個人用の鍵(ADR-142)。
 *
 * 鍵は発行したときに1回だけ画面に出し、サーバーには SHA-256 のハッシュだけを残す(鍵そのものは残さない)。
 * 置き場所は本人(オーナー)の Supabase のユーザーの app_metadata(本人のブラウザからは書けず、管理キーを
 * 持つサーバーだけが書ける)。表を増やさないので、データベースへの適用(SQL)は要らない。
 *
 *   - MCP は本人として家計簿を読む(LINE と同じ runAsOwner)ので、発行できるのも本人だけ。
 *   - 鍵は「kkb_」で始まる。何に使っている鍵か分かるよう名前を付け、いつでも取り消せる。
 */
import 'server-only';

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import { findOwner, type OwnerUser } from '@/lib/supabase/owner';

type Admin = ReturnType<typeof createAdminClient>;

export const MCP_TOKEN_PREFIX = 'kkb_';
/** 同時に持てる鍵の数。 */
export const MAX_MCP_TOKENS = 5;

/** app_metadata に置く1件(鍵そのものは無い)。 */
export type StoredMcpToken = {
  id: string;
  name: string;
  /** 鍵の SHA-256(16進)。 */
  hash: string;
  /** 見分けるための先頭(「kkb_ab12…」)。 */
  hint: string;
  createdAt: string;
};

/** 画面に出す形(ハッシュは出さない)。 */
export type McpTokenView = Omit<StoredMcpToken, 'hash'>;

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 新しい鍵(32バイトの乱数)。 */
export function newMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** app_metadata から鍵の一覧を読む(形の読めない行は捨てる)。 */
export function storedTokensOf(appMetadata: unknown): StoredMcpToken[] {
  const raw = (appMetadata as { mcp_tokens?: unknown } | null | undefined)?.mcp_tokens;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is StoredMcpToken =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as StoredMcpToken).id === 'string' &&
      typeof (t as StoredMcpToken).name === 'string' &&
      typeof (t as StoredMcpToken).hash === 'string' &&
      /^[0-9a-f]{64}$/.test((t as StoredMcpToken).hash) &&
      typeof (t as StoredMcpToken).hint === 'string' &&
      typeof (t as StoredMcpToken).createdAt === 'string',
  );
}

/** 送られてきた鍵が、持っている鍵のどれかと合うか(時間で中身が漏れない比べ方)。 */
export function matchMcpToken(
  token: string,
  stored: readonly StoredMcpToken[],
): StoredMcpToken | null {
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 200) return null;
  const sent = Buffer.from(hashMcpToken(token), 'hex');
  let hit: StoredMcpToken | null = null;
  for (const t of stored) {
    const mine = Buffer.from(t.hash, 'hex');
    if (mine.length === sent.length && timingSafeEqual(mine, sent)) hit = t;
  }
  return hit;
}

export function toView(t: StoredMcpToken): McpTokenView {
  return { id: t.id, name: t.name, hint: t.hint, createdAt: t.createdAt };
}

async function ownerTokens(
  admin: Admin,
): Promise<{ owner: OwnerUser; metadata: Record<string, unknown>; tokens: StoredMcpToken[] }> {
  const { user: owner, error } = await findOwner(admin);
  if (error || !owner) throw new Error('家計簿の持ち主が見つかりませんでした。');
  const { data, error: getError } = await admin.auth.admin.getUserById(owner.id);
  if (getError || !data.user) throw new Error('鍵を読めませんでした。');
  const metadata = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  return { owner, metadata, tokens: storedTokensOf(metadata) };
}

/** 送られてきた鍵を確かめ、合えば本人(オーナー)を返す。 */
export async function verifyMcpToken(admin: Admin, token: string): Promise<OwnerUser | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const { owner, tokens } = await ownerTokens(admin);
  return matchMcpToken(token, tokens) ? owner : null;
}

/** 鍵の一覧(本人だけ)。 */
export async function listMcpTokens(admin: Admin, userId: string): Promise<McpTokenView[]> {
  const { owner, tokens } = await ownerTokens(admin);
  if (owner.id !== userId) return [];
  return tokens.map(toView);
}

/** 鍵を発行する。鍵そのものはこの戻り値でしか見られない。 */
export async function issueMcpToken(
  admin: Admin,
  userId: string,
  name: string,
): Promise<{ token: string; view: McpTokenView }> {
  const { owner, metadata, tokens } = await ownerTokens(admin);
  if (owner.id !== userId) throw new Error('家計簿の持ち主だけが発行できます。');
  if (tokens.length >= MAX_MCP_TOKENS) {
    throw new Error(`鍵は${MAX_MCP_TOKENS}個までです。使っていない鍵を取り消してください。`);
  }
  const token = newMcpToken();
  const stored: StoredMcpToken = {
    id: randomUUID(),
    name: name.trim().slice(0, 40) || 'AI',
    hash: hashMcpToken(token),
    hint: `${token.slice(0, MCP_TOKEN_PREFIX.length + 4)}…`,
    createdAt: new Date().toISOString(),
  };
  const { error } = await admin.auth.admin.updateUserById(owner.id, {
    app_metadata: { ...metadata, mcp_tokens: [...tokens, stored] },
  });
  if (error) throw new Error('鍵を保存できませんでした。');
  return { token, view: toView(stored) };
}

/** 鍵を取り消す(その鍵ではもう読めない)。 */
export async function revokeMcpToken(admin: Admin, userId: string, id: string): Promise<void> {
  const { owner, metadata, tokens } = await ownerTokens(admin);
  if (owner.id !== userId) throw new Error('家計簿の持ち主だけが取り消せます。');
  const { error } = await admin.auth.admin.updateUserById(owner.id, {
    app_metadata: { ...metadata, mcp_tokens: tokens.filter((t) => t.id !== id) },
  });
  if (error) throw new Error('鍵を取り消せませんでした。');
}
