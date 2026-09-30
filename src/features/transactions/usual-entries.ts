import { hourJst, weekdayOf } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { UsualEntryHistoryRow } from '@/domain/usual-entries';

/**
 * 「いつもの」予測(N2)のための履歴データ。店名・ジャンル・金額・曜日・時間帯
 * (JST)を持つ。ジャンル名は呼び出し側が既に持っている一覧から引く
 * (ここでは genre_id だけを返す)。
 */
export async function fetchUsualEntryHistory(
  limit = 300,
): Promise<Omit<UsualEntryHistoryRow, 'genreName'>[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('transactions')
    .select('merchant_name, genre_id, amount_yen, occurred_on, created_at')
    .not('merchant_name', 'is', null)
    .lt('amount_yen', 0)
    .order('occurred_on', { ascending: false })
    .limit(limit);

  return (data ?? [])
    .filter((row): row is typeof row & { merchant_name: string } => row.merchant_name !== null)
    .map((row) => ({
      storeName: row.merchant_name,
      genreId: row.genre_id,
      amountYen: Math.abs(row.amount_yen),
      weekday: weekdayOf(row.occurred_on),
      hour: row.created_at ? hourJst(new Date(row.created_at)) : null,
    }));
}
