import { listTodayCheck } from '@/features/today-check/store';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { TodayCheckLauncher } from '../spending/today-check-launcher';

/** 今日の画面の「今日の答え合わせ N件」(片づけるものがあるときだけ、ADR-129)。 */
export async function TodayCheckCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const count = await countTodayCheck().catch(() => 0);
  if (count === 0 && !autoOpen) return null;
  return <TodayCheckLauncher count={count} variant="today" autoOpen={autoOpen} />;
}

export async function countTodayCheck(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return 0;
  return (await listTodayCheck(supabase, data.user.id, todayJst())).length;
}
