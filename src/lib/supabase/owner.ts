/**
 * 「本人(オーナー)」のユーザーを決める(ADR-066)。
 *
 * cron・LINE の受信・Gmail・Google のように、環境変数に1人分の資格情報を持つ連携は、
 * 特定の1人のものとして動く。ユーザーが増えても、これらが別の人のデータに触れないよう、
 * 「先頭のユーザー」ではなくここで明示的に決める。
 *   1. OWNER_EMAIL があれば、そのメールアドレスのユーザー。
 *   2. 無ければ、最初に作ったユーザー(作成日時の順で先頭)。
 */
import 'server-only';

import { getOwnerEmail } from '@/lib/env';
import type { createAdminClient } from './admin';

type Admin = ReturnType<typeof createAdminClient>;

export type OwnerUser = { id: string; email?: string | undefined; created_at: string };

/** ユーザーの一覧から、オーナーを選ぶ(純粋関数)。 */
export function pickOwner<T extends OwnerUser>(
  users: readonly T[],
  ownerEmail: string | null,
): T | null {
  if (users.length === 0) return null;
  if (ownerEmail !== null) {
    const hit = users.find((u) => u.email?.toLowerCase() === ownerEmail);
    if (hit) return hit;
  }
  return [...users].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!;
}

export async function findOwner(
  admin: Admin,
): Promise<{ user: OwnerUser | null; error: { message: string } | null }> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return { user: null, error: { message: error.message } };
  return { user: pickOwner(data.users, getOwnerEmail()), error: null };
}
