import { createClient } from '@/lib/supabase/server';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { todayJst } from '@/lib/date';

/** バナーと処理一覧は、同じ pending 状態を全期間から読む。 */
export async function listPendingReviewRecords() {
  const result = await loadLedgerTransactions(
    { from: '0001-01-01', to: '9999-12-31' },
    todayJst(),
    { reviewStatus: 'pending' },
  );
  return result.transactions;
}

/** 1件なら画像入力へ直行できるよう、件数と先頭IDを同じ検索で取得する。 */
export async function needsInputSummary(): Promise<{ count: number; firstId: string | null }> {
  try {
    const supabase = await createClient();
    const { data, count, error } = await supabase
      .from('receipt_captures')
      .select('id', { count: 'exact' })
      .eq('status', 'needs_input')
      .order('created_at', { ascending: false })
      .limit(1);
    return error
      ? { count: 0, firstId: null }
      : { count: count ?? 0, firstId: data?.[0]?.id ?? null };
  } catch {
    return { count: 0, firstId: null };
  }
}

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

/** 保存前のレシート(読み取れた。本人が「保存」を押すまで明細にしない、ADR-133)の件数。数えられなければ 0。 */
export async function countReadyCaptures(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('receipt_captures')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ready');
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}
