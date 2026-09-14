/**
 * 明細の複数カテゴリ分割のデータアクセス(本人発案)。
 *
 * 判断(合計が一致するか)は domain/transaction-splits.ts の純粋関数に任せ、
 * ここでは「DB から何を読むか」「DB へどう書くか」だけを担う
 * (features/alerts/store.ts と同じ分離)。
 *
 * `transaction_splits` は本番 Supabase へのマイグレーション適用手段がこの
 * セッションに無く(T-25/T-26/B-7 と同じ制約)未適用のため、毎回の画面表示・
 * 集計で無条件に読む2関数(listSplitsForDisplay/listSplitsForTransactionIds)は
 * テーブル未作成のエラー(PGRST205)を「分割は無い」として握り潰す
 * (rescued_emails/net_worth_snapshots と同じ考え方。適用後は自動的に効き始める)。
 * 一方 replaceSplits() は本人が明示的に押した保存操作なので握り潰さず、
 * 分かりやすいメッセージにしてそのままエラーとして返す。
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import {
  assertValidSplits,
  TransactionSplitError,
  type TransactionSplitInput,
} from '@/domain/transaction-splits';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class TransactionSplitStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionSplitStoreError';
  }
}

export type TransactionSplit = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amountYen: number;
  note: string | null;
};

function isMissingTableError(error: Pick<PostgrestError, 'code'>): boolean {
  return error.code === 'PGRST205';
}

/**
 * 分割をまるごと置き換える(既存の全行を削除し、新しい内容で作り直す)。
 * 空配列を渡すと分割を解除する(通常の単一カテゴリの明細に戻る)。
 *
 * `transactions.amount_yen` は書き換えない。分割の合計と一致するかは
 * `assertValidSplits()` が保証するため、常に一致した状態が保たれる。
 */
export async function replaceSplits(
  transactionId: string,
  splits: readonly TransactionSplitInput[],
): Promise<void> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new TransactionSplitStoreError('ログイン状態を確認できませんでした');
  }

  const { data: transaction, error: transactionError } = await supabase
    .from('transactions')
    .select('amount_yen')
    .eq('id', transactionId)
    .single();
  if (transactionError) {
    throw new TransactionSplitStoreError(`明細を取得できませんでした: ${transactionError.message}`);
  }

  if (splits.length > 0) {
    try {
      assertValidSplits(splits, transaction.amount_yen);
    } catch (error) {
      if (error instanceof TransactionSplitError) {
        throw new TransactionSplitStoreError(error.message);
      }
      throw error;
    }
  }

  const { error: deleteError } = await supabase
    .from('transaction_splits')
    .delete()
    .eq('transaction_id', transactionId);
  if (deleteError) {
    if (isMissingTableError(deleteError)) {
      throw new TransactionSplitStoreError('分割機能はまだ利用できません');
    }
    throw new TransactionSplitStoreError(
      `既存の分割を削除できませんでした: ${deleteError.message}`,
    );
  }

  if (splits.length === 0) return;

  const { error: insertError } = await supabase.from('transaction_splits').insert(
    splits.map((s) => ({
      user_id: auth.user.id,
      transaction_id: transactionId,
      category_id: s.categoryId,
      amount_yen: s.amountYen,
      note: s.note,
    })),
  );
  if (insertError) {
    if (isMissingTableError(insertError)) {
      throw new TransactionSplitStoreError('分割機能はまだ利用できません');
    }
    throw new TransactionSplitStoreError(`分割を保存できませんでした: ${insertError.message}`);
  }
}

/**
 * 一覧画面向け:表示中の明細群の分割をまとめて読む(セッション版、表示用)。
 * 1明細ずつ問い合わせない。
 */
export async function listSplitsForDisplay(
  transactionIds: readonly string[],
): Promise<Map<string, TransactionSplit[]>> {
  const map = new Map<string, TransactionSplit[]>();
  if (transactionIds.length === 0) return map;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('transaction_splits')
    .select('id, transaction_id, category_id, amount_yen, note')
    .in('transaction_id', transactionIds)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return map;
    throw new TransactionSplitStoreError(`分割を取得できませんでした: ${error.message}`);
  }
  if (rows.length === 0) return map;

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('id, name');
  if (categoriesError) {
    throw new TransactionSplitStoreError(
      `カテゴリを取得できませんでした: ${categoriesError.message}`,
    );
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  for (const row of rows) {
    const list = map.get(row.transaction_id) ?? [];
    list.push({
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_id ? (categoryNameById.get(row.category_id) ?? null) : null,
      amountYen: row.amount_yen,
      note: row.note,
    });
    map.set(row.transaction_id, list);
  }
  return map;
}

/**
 * 指定した明細群の分割を一括で読む(集計処理向け)。
 * `client` は admin/session どちらでも渡せる(features/alerts/store.ts の
 * *AsAdmin 関数群と同じく、呼び出し側が既に user_id/RLS で絞り込んだ
 * transactionIds を渡してくる前提)。
 */
export async function listSplitsForTransactionIds(
  client: SupabaseClient<Database>,
  transactionIds: readonly string[],
): Promise<Map<string, { categoryId: string | null; amountYen: number }[]>> {
  const map = new Map<string, { categoryId: string | null; amountYen: number }[]>();
  if (transactionIds.length === 0) return map;

  const { data, error } = await client
    .from('transaction_splits')
    .select('transaction_id, category_id, amount_yen')
    .in('transaction_id', transactionIds);
  if (error) {
    if (isMissingTableError(error)) return map;
    throw new TransactionSplitStoreError(`分割を取得できませんでした: ${error.message}`);
  }

  for (const row of data) {
    const list = map.get(row.transaction_id) ?? [];
    list.push({ categoryId: row.category_id, amountYen: row.amount_yen });
    map.set(row.transaction_id, list);
  }
  return map;
}
