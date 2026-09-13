'use server';

/**
 * 明細の Server Action(T-7)。
 *
 * 取り込み画面(CSV・貼り付け)はプレビューをクライアント側で組み立て
 * (features/transactions/import-pipeline.ts、DB に触れない純粋関数)、
 * 確定時にここを呼んで実際に保存する。
 */

import { revalidatePath } from 'next/cache';

import type { TransactionSplitInput } from '@/domain/transaction-splits';
import {
  importTransactions,
  updateTransaction,
  TransactionStoreError,
  type StoredTransaction,
  type TransactionSource,
} from '@/features/transactions/store';
import { replaceSplits, TransactionSplitStoreError } from '@/features/transactions/splits-store';

export async function saveImportBatchAction(
  preview: readonly StoredTransaction[],
  meta: { fileName: string; source: TransactionSource; accountId: string; failedCount: number },
): Promise<{ imported: number; duplicates: number; error: string | null }> {
  try {
    const result = await importTransactions(preview, meta);
    revalidatePath('/transactions');
    return { imported: result.importedCount, duplicates: result.duplicateCount, error: null };
  } catch (error) {
    const message =
      error instanceof TransactionStoreError ? error.message : '取り込みに失敗しました。';
    return { imported: 0, duplicates: 0, error: message };
  }
}

export async function updateTransactionAction(
  id: string,
  categoryId: string,
): Promise<{ error: string | null }> {
  try {
    await updateTransaction(id, categoryId);
  } catch (error) {
    return {
      error: error instanceof TransactionStoreError ? error.message : '更新に失敗しました。',
    };
  }
  revalidatePath('/transactions');
  revalidatePath('/transactions/review');
  return { error: null };
}

/** 明細の複数カテゴリ分割を保存する(本人発案)。空配列を渡すと分割を解除する。 */
export async function replaceSplitsAction(
  transactionId: string,
  splits: readonly TransactionSplitInput[],
): Promise<{ error: string | null }> {
  try {
    await replaceSplits(transactionId, splits);
  } catch (error) {
    return {
      error:
        error instanceof TransactionSplitStoreError ? error.message : '分割の保存に失敗しました。',
    };
  }
  revalidatePath('/transactions');
  return { error: null };
}
