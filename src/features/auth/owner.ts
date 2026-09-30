/**
 * いま見ているユーザーが「本人(オーナー)」か(ADR-066)。環境変数に1人分の資格情報を持つ連携
 * (Gmail・Google・LINE・cron)は、オーナーのアカウントだけで動くため、それ以外のユーザーには
 * 設定画面を見せない。
 */
import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { findOwner } from '@/lib/supabase/owner';
import { createClient } from '@/lib/supabase/server';

export async function isCurrentUserOwner(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;
    const { user: owner } = await findOwner(createAdminClient());
    return owner !== null && owner.id === data.user.id;
  } catch {
    return false;
  }
}
