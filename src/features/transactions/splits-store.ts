/**
 * 明細の複数カテゴリ分割のデータアクセス。合計の検証は
 * domain/transaction-splits.ts の純粋関数が担う。
 *
 * `transaction_splits` は本番未適用(B-7)。未適用時の扱いは lib/supabase/errors.ts。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  assertValidSplits,
  TransactionSplitError,
  type TransactionSplitInput,
} from '@/domain/transaction-splits';
import { AppError } from '@/lib/errors';
import { isMissingTableError } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

export class TransactionSplitStoreError extends AppError {}

export type TransactionSplit = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amountYen: number;
  note: string | null;
};

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
