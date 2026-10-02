/**
 * ホームの貯蓄。完済の残債ではなく、今月の収入から使った額を引いた残り。
 * 振替と対象外は数えない。
 */

import { monthStartJst, todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

export type MonthSavings = {
  incomeYen: number;
  spentYen: number;
  savedYen: number;
  rate: number | null;
};

export async function loadMonthSavings(now: Date = new Date()): Promise<MonthSavings> {
  const supabase = await createClient();
  const from = monthStartJst(0, now);
  const to = monthStartJst(1, now);
  const { data, error } = await supabase
    .from('transactions')
    .select('amount_yen, is_transfer, review_status, occurred_on')
    .gte('occurred_on', from)
    .lt('occurred_on', to);
  if (error) throw new Error(`貯蓄を計算できませんでした: ${error.message}`);

  let incomeYen = 0;
  let spentYen = 0;
  for (const row of data ?? []) {
    if (row.is_transfer || row.review_status === 'ignored') continue;
    if (row.occurred_on > todayJst(now)) continue;
    if (row.amount_yen > 0) incomeYen += row.amount_yen;
    else spentYen += -row.amount_yen;
  }
  const savedYen = incomeYen - spentYen;
  return {
    incomeYen,
    spentYen,
    savedYen,
    rate: incomeYen > 0 ? Math.max(0, Math.min(1, savedYen / incomeYen)) : null,
  };
}
