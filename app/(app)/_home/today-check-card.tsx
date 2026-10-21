import { listTodayCheck } from '@/features/today-check/store';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

/**
 * 今日の答え合わせの件数(カテゴリの確認待ちを含む、ADR-129・131)。今日の画面の「今日やること」と
 * 「確認が必要」のいちばん上で使う。
 */
export async function countTodayCheck(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return 0;
  return (await listTodayCheck(supabase, data.user.id, todayJst())).length;
}
