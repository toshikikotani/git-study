/**
 * 「生活費」明細の小分類(transaction_expense_subtypes)のデータアクセス
 * (本人発案、ADR-036)。
 *
 * receipt_items・transaction_splits と同じく、明細本体(transactions)とは
 * 独立した別テーブル——この値は今のところレシート取り込みからしか生まれ
 * ないため、transactions 本体に列を足すとレシート以外の経路(CSV・メール)
 * にとって意味の無い列が常に付いて回ることになる(ADR-036 参照)。
 *
 * `transaction_expense_subtypes` は本番未適用。未適用時の扱いは他の新規
 * テーブルと同じ(読み取りは「小分類はまだ無い」として握り潰す。保存は
 * 本人の明示的な操作=レシート取り込みの一部だが、取り込み自体は失敗させず
 * 警告に留める、receipt/page.tsx 参照)。
 */

import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';

export class ExpenseSubtypeStoreError extends AppError {}

/**
 * 1件分の小分類を保存する(upsert、再取り込み時の置き換えを想定)。
 * 空文字・空白だけの値は保存しない(呼び出し側で弾くのが筋だが、DB制約
 * (ck_transaction_expense_subtypes_not_blank)にも同じ条件を持たせてある)。
 */
export async function setExpenseSubtype(transactionId: string, subtype: string): Promise<void> {
  const trimmed = subtype.trim();
  if (trimmed === '') return;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new ExpenseSubtypeStoreError('ログイン状態を確認できませんでした');
  }

  const { error } = await supabase.from('transaction_expense_subtypes').upsert({
    transaction_id: transactionId,
    user_id: auth.user.id,
    subtype: trimmed,
  });
  if (error) {
    if (isMissingTableError(error)) {
      throw new ExpenseSubtypeStoreError('生活費の小分類はまだ利用できません');
    }
    throw new ExpenseSubtypeStoreError(`生活費の小分類を保存できませんでした: ${error.message}`);
  }
}

/**
 * 一覧画面向け:表示中の明細群の小分類をまとめて読む(items-store.ts の
 * listReceiptItemsForTransactionIds() と同じパターン)。
 */
export async function listExpenseSubtypesForTransactionIds(
  transactionIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (transactionIds.length === 0) return map;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transaction_expense_subtypes')
    .select('transaction_id, subtype')
    .in('transaction_id', transactionIds);
  if (error) {
    if (isMissingTableError(error)) return map;
    throw new ExpenseSubtypeStoreError(`生活費の小分類を取得できませんでした: ${error.message}`);
  }

  for (const row of data) {
    map.set(row.transaction_id, row.subtype);
  }
  return map;
}
