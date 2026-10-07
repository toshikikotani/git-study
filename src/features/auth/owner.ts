/**
 * いまログインしている人がオーナー(本人)か(ADR-082)。
 *
 * 朝配信・アラートの送信・LINE・Gmail・Google の連携は、環境変数に1人分の資格情報を持つため、
 * オーナーだけが使う(lib/supabase/owner.ts の findOwner と同じ人)。ほかの利用者には、
 * その画面・メニューを出さない。家計簿・貯金・予測などほかの機能は、誰でも自分のデータで使える。
 */
import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getOwnerEmail } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { findOwner } from '@/lib/supabase/owner';
import { createClient } from '@/lib/supabase/server';

export type CurrentAccount = { email: string | null; isOwner: boolean };

/** 同じリクエストの中では1回だけ調べる。調べられなければオーナーではない扱い(連携を出さない)。 */
export const getCurrentAccount = cache(async (): Promise<CurrentAccount> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { email: null, isOwner: false };
  const email = data.user.email ?? null;

  // OWNER_EMAIL があれば、メールアドレスを比べるだけで足りる(管理 API を呼ばない)。
  const ownerEmail = getOwnerEmail();
  if (ownerEmail !== null) {
    return { email, isOwner: email?.toLowerCase() === ownerEmail };
  }
  try {
    const { user } = await findOwner(createAdminClient());
    return { email, isOwner: user?.id === data.user.id };
  } catch {
    return { email, isOwner: false };
  }
});

export async function isCurrentUserOwner(): Promise<boolean> {
  return (await getCurrentAccount()).isOwner;
}

/** オーナー専用の画面の入口で呼ぶ。オーナーでなければ「見つかりません」にする。 */
export async function requireOwner(): Promise<void> {
  if (!(await isCurrentUserOwner())) notFound();
}
