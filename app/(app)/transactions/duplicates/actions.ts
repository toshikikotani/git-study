'use server';

/**
 * 重複候補の片側を集計対象から外す Server Action(本人発案)。
 *
 * 行は消さず review_status='ignored' にするだけ(理由は
 * features/transactions/store.ts の ignoreTransaction() 参照)。
 */

import { revalidatePath } from 'next/cache';

import { ignoreTransaction, TransactionStoreError } from '@/features/transactions/store';

export async function ignoreTransactionAction(id: string): Promise<{ error: string | null }> {
  try {
    await ignoreTransaction(id);
  } catch (error) {
    if (error instanceof TransactionStoreError) return { error: error.message };
    return { error: '明細を除外できませんでした。' };
  }

  revalidatePath('/transactions/duplicates');
  revalidatePath('/transactions');
  return { error: null };
}
