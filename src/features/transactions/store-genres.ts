import { comparableKey } from '@/domain/store-name';
import { createClient } from '@/lib/supabase/server';

/** 覚えておく店の数(新しい記録から)。 */
const LIMIT_ROWS = 1000;

/**
 * 店名 → 前回のカテゴリ(記録する、デザイン v3-4、ADR-108)。店名を入れると、前回その店で選んだ
 * カテゴリを先に選ぶ。キーは比較用の形(表記ゆれをまとめる)。レシート名と店名の両方で引ける。
 */
export async function fetchStoreGenres(): Promise<[string, string][]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('transactions')
    .select('description, merchant_name, genre_id')
    .lt('amount_yen', 0)
    .not('genre_id', 'is', null)
    .order('occurred_on', { ascending: false })
    .limit(LIMIT_ROWS);
  const latest = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.genre_id === null) continue;
    for (const name of [row.description, row.merchant_name]) {
      const key = name ? comparableKey(name) : '';
      if (key !== '' && !latest.has(key)) latest.set(key, row.genre_id);
    }
  }
  return [...latest.entries()];
}
