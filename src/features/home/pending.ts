import { createClient } from '@/lib/supabase/server';

/** 確認待ちの記録(自動の分類で確かめが要る明細)の件数。数えられなければ 0。 */
export async function countPendingReview(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending');
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}
