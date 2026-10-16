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

/** 入力待ちのレシート(読み取れなかったもの)の件数。数えられなければ 0。 */
export async function countNeedsInputCaptures(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('receipt_captures')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'needs_input');
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}
