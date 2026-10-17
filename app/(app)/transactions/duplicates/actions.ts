'use server';

/**
 * 重複候補の片側を集計対象から外す Server Action(本人発案)。
 *
 * 行は消さず review_status='ignored' にするだけ(理由は
 * features/transactions/store.ts の ignoreTransaction() 参照)。
 */

import { revalidatePath } from 'next/cache';

import { ignoreTransaction, TransactionStoreError } from '@/features/transactions/store';
import {
  DuplicateStoreError,
  saveDistinctPair,
  undoDistinctPair,
} from '@/features/transactions/duplicates-store';

export async function ignoreTransactionAction(id: string): Promise<{ error: string | null }> {
  try {
    await ignoreTransaction(id);
  } catch (error) {
    if (error instanceof TransactionStoreError) return { error: error.message };
    return { error: '明細を除外できませんでした。' };
  }

  revalidatePath('/transactions/duplicates');
  revalidatePath('/spending');
  return { error: null };
}

export async function saveDistinctPairAction(
  aId: string,
  bId: string,
  signature: string,
): Promise<{ error: string | null }> {
  try {
    await saveDistinctPair(aId, bId, signature);
  } catch (error) {
    return {
      error:
        error instanceof DuplicateStoreError ? error.message : '確認結果を保存できませんでした。',
    };
  }
  revalidatePath('/transactions/duplicates');
  revalidatePath('/spending');
  return { error: null };
}

export async function undoDistinctPairAction(
  aId: string,
  bId: string,
  signature: string,
): Promise<{ error: string | null }> {
  try {
    await undoDistinctPair(aId, bId, signature);
  } catch (error) {
    return {
      error: error instanceof DuplicateStoreError ? error.message : '確認結果を戻せませんでした。',
    };
  }
  revalidatePath('/transactions/duplicates');
  revalidatePath('/spending');
  return { error: null };
}
