import { createClient } from '@/lib/supabase/server';

/** 最近の店(入力の候補)。直近の明細の店名を、重複なく新しい順に並べる。 */
export async function recentStoreNames(limit = 8): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('transactions')
    .select('merchant_name')
    .not('merchant_name', 'is', null)
    .order('occurred_on', { ascending: false })
    .limit(80);
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (row.merchant_name && !seen.has(row.merchant_name)) seen.add(row.merchant_name);
    if (seen.size >= limit) break;
  }
  return [...seen];
}
