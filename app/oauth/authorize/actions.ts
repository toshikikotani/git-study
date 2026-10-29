'use server';

/**
 * 同意画面の「許可する」(ADR-143)。求めをもう一度確かめ、持ち主なら、つないだアプリを作って
 * 認可コード付きでアプリへ戻す。
 */

import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isCurrentUserOwner } from '@/features/auth/owner';
import { originOf } from '@/features/mcp/http';
import { approveAuthorization, oauthUrls, parseAuthorizeRequest } from '@/features/mcp/oauth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function approveAction(query: string): Promise<{ error: string }> {
  const urls = oauthUrls(originOf(await headers()));
  const parsed = parseAuthorizeRequest(new URLSearchParams(query), urls.mcp);
  if (!parsed.ok) return { error: '求めの中身が変わりました。アプリからつなぎ直してください。' };
  if (!(await isCurrentUserOwner())) return { error: '家計簿の持ち主だけが許可できます。' };
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { error: 'ログインし直してください。' };
  let to: string;
  try {
    to = await approveAuthorization(createAdminClient(), data.user.id, parsed.request, urls.issuer);
  } catch (error) {
    return { error: error instanceof Error ? error.message : '許可できませんでした。' };
  }
  // 戻り先はアプリの外(登録した URL)。
  redirect(to as Route);
}
