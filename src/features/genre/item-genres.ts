import { effectiveGenreId } from '@/domain/genre';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class ItemGenreError extends AppError {}

/** `.in()` は URL に載るため、明細IDを分けて取得する。 */
const ID_CHUNK = 100;

/**
 * 明細本体にジャンルが無い支出について、レシート品目のジャンルから決めた
 * 代表ジャンル(domain/genre.ts の effectiveGenreId)を返す。品目ごとに
 * ジャンルを付けた明細が、明細本体のジャンルが空のまま「未分類」と
 * 表示され続けるのを防ぐ(品目側で分類した明細は次回のジャンル分類の
 * 対象にもならないため、放置すると永久に未分類に見える)。
 * 戻り値には、代表ジャンルが決まった明細だけを含む。
 */
export async function resolveItemGenres(
  rows: readonly { id: string; genre_id: string | null; amount_yen: number }[],
): Promise<Map<string, string>> {
  const pendingIds = rows.filter((r) => r.genre_id === null && r.amount_yen < 0).map((r) => r.id);
  const resolved = new Map<string, string>();
  if (pendingIds.length === 0) return resolved;

  const supabase = await createClient();
  const itemsByTransaction = new Map<string, { genreId: string | null; amountYen: number }[]>();
  for (let i = 0; i < pendingIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('receipt_items')
      .select('transaction_id, genre_id, amount_yen')
      .in('transaction_id', pendingIds.slice(i, i + ID_CHUNK));
    if (error) {
      if (isMissingTableError(error)) return resolved;
      throw new ItemGenreError(`品目を取得できませんでした: ${error.message}`);
    }
    for (const item of data) {
      const list = itemsByTransaction.get(item.transaction_id) ?? [];
      list.push({ genreId: item.genre_id, amountYen: item.amount_yen });
      itemsByTransaction.set(item.transaction_id, list);
    }
  }

  for (const [transactionId, items] of itemsByTransaction) {
    const genreId = effectiveGenreId(null, items);
    if (genreId !== null) resolved.set(transactionId, genreId);
  }
  return resolved;
}
