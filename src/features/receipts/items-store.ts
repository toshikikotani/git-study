/**
 * レシートの品目(receipt_items)のデータアクセス(ADR-034)。
 *
 * `transaction_splits`(カテゴリ分割)とは独立している。品目は分割の対象に
 * なるかどうかに関わらず、常に付く記録(合計の一致は求めない)。
 *
 * `receipt_items` は本番未適用。未適用時の扱いは lib/supabase/errors.ts
 * (読み取りは「品目はまだ無い」として握り潰す。保存は本人の明示的な操作
 * =レシート取り込みの一部だが、取り込み自体は失敗させず警告に留める、
 * receipt/page.tsx 参照)。
 */

import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class ReceiptItemStoreError extends AppError {}

export type ReceiptItemInput = { name: string; amountYen: number };

/**
 * 品目をまるごと置き換える(既存の全行を削除し、新しい内容で作り直す)。
 * 空配列を渡すと品目を無くす(取り込み直後の再保存・訂正を想定)。
 */
export async function replaceReceiptItems(
  transactionId: string,
  items: readonly ReceiptItemInput[],
): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ReceiptItemStoreError('ログイン状態を確認できませんでした');
  }

  const { error: deleteError } = await supabase
    .from('receipt_items')
    .delete()
    .eq('transaction_id', transactionId);
  if (deleteError) {
    if (isMissingTableError(deleteError)) {
      throw new ReceiptItemStoreError('品目の記録機能はまだ利用できません');
    }
    throw new ReceiptItemStoreError(`既存の品目を削除できませんでした: ${deleteError.message}`);
  }

  if (items.length === 0) return;

  const { error: insertError } = await supabase.from('receipt_items').insert(
    items.map((item, i) => ({
      user_id: auth.user.id,
      transaction_id: transactionId,
      name: item.name,
      amount_yen: item.amountYen,
      sort_order: i,
    })),
  );
  if (insertError) {
    if (isMissingTableError(insertError)) {
      throw new ReceiptItemStoreError('品目の記録機能はまだ利用できません');
    }
    throw new ReceiptItemStoreError(`品目を保存できませんでした: ${insertError.message}`);
  }
}

export type ReceiptItem = { name: string; amountYen: number };

/**
 * 一覧画面向け:表示中の明細群の品目をまとめて読む(splits-store.ts の
 * listSplitsForDisplay() と同じパターン、1明細ずつ問い合わせない)。
 */
export async function listReceiptItemsForTransactionIds(
  transactionIds: readonly string[],
): Promise<Map<string, ReceiptItem[]>> {
  const map = new Map<string, ReceiptItem[]>();
  if (transactionIds.length === 0) return map;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('receipt_items')
    .select('transaction_id, name, amount_yen')
    .in('transaction_id', transactionIds)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return map;
    throw new ReceiptItemStoreError(`品目を取得できませんでした: ${error.message}`);
  }

  for (const row of rows) {
    const list = map.get(row.transaction_id) ?? [];
    list.push({ name: row.name, amountYen: row.amount_yen });
    map.set(row.transaction_id, list);
  }
  return map;
}
