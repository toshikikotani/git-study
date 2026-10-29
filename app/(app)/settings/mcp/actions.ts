'use server';

/**
 * 設定 › AI とつなぐ(MCP)の鍵の発行・取り消し(ADR-142)。持ち主(オーナー)だけ。
 * 発行した鍵そのものは、この戻り値で1回だけ画面に出す(サーバーにはハッシュだけを残す)。
 */

import { revalidatePath } from 'next/cache';

import { isCurrentUserOwner } from '@/features/auth/owner';
import { revokeGrant } from '@/features/mcp/oauth';
import { issueMcpToken, revokeMcpToken, type McpTokenView } from '@/features/mcp/tokens';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

async function ownerId(): Promise<string | null> {
  if (!(await isCurrentUserOwner())) return null;
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.id ?? null;
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export async function issueMcpTokenAction(
  name: string,
): Promise<{ token: string; view: McpTokenView; error: null } | { error: string }> {
  const userId = await ownerId();
  if (userId === null) return { error: '家計簿の持ち主だけが発行できます。' };
  try {
    const { token, view } = await issueMcpToken(createAdminClient(), userId, name);
    revalidatePath('/settings/mcp');
    return { token, view, error: null };
  } catch (error) {
    return { error: messageOf(error, '鍵を発行できませんでした。') };
  }
}

export async function revokeMcpTokenAction(id: string): Promise<{ error: string | null }> {
  const userId = await ownerId();
  if (userId === null) return { error: '家計簿の持ち主だけが取り消せます。' };
  try {
    await revokeMcpToken(createAdminClient(), userId, id);
    revalidatePath('/settings/mcp');
    return { error: null };
  } catch (error) {
    return { error: messageOf(error, '鍵を取り消せませんでした。') };
  }
}

/** ChatGPT・Claude のアプリとのつながりを外す(OAuth、ADR-143)。 */
export async function revokeGrantAction(id: string): Promise<{ error: string | null }> {
  const userId = await ownerId();
  if (userId === null) return { error: '家計簿の持ち主だけが外せます。' };
  try {
    await revokeGrant(createAdminClient(), userId, id);
    revalidatePath('/settings/mcp');
    return { error: null };
  } catch (error) {
    return { error: messageOf(error, '外せませんでした。') };
  }
}
