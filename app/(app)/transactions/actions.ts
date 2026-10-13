'use server';

import { revalidatePath } from 'next/cache';
import type { TransactionSplitInput } from '@/domain/transaction-splits';
import { assertYen, MoneyError } from '@/domain/money';
import { setExpenseSubtype } from '@/features/receipts/expense-subtype-store';
import { replaceReceiptItems, type ReceiptItemInput } from '@/features/receipts/items-store';
import {
  importTransactions,
  updateTransaction,
  updateTransactionMemo,
  TransactionStoreError,
  type StoredTransaction,
  type TransactionSource,
} from '@/features/transactions/store';
import { replaceSplits } from '@/features/transactions/splits-store';
import { findReceiptDuplicates } from '@/domain/receipt-duplicate';
import { normalizeStoreName } from '@/domain/store-name';
import { recordCorrection } from '@/features/genre/memory-store';
import { fingerprintOf } from '@/features/transactions/types';
import { assertDateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { describeUserError } from '@/lib/errors';

export type RowFields = {
  id: string;
  genre_id: string | null;
  classified_by: 'unclassified' | 'rule' | 'ai' | 'manual';
  review_status: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  reviewed_at: string | null;
  amount_yen: number;
  occurred_on: string;
  note: string | null;
  kind: string | null;
  reconcile_diff_yen: number | null;
};

export type DeletedSnapshot = {
  row: Record<string, unknown>;
  splits: Record<string, unknown>[];
  items: Record<string, unknown>[];
  subtypes: Record<string, unknown>[];
};

async function readRowFields(ids: readonly string[]): Promise<RowFields[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('transactions').select('*').in('id', [...ids]);
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      id: r.id,
      genre_id: r.genre_id,
      classified_by: r.classified_by,
      review_status: r.review_status,
      reviewed_at: r.reviewed_at,
      amount_yen: r.amount_yen,
      occurred_on: r.occurred_on,
      note: r.note,
      kind: (row.kind as string | null) ?? null,
      reconcile_diff_yen: (row.reconcile_diff_yen as number | null) ?? null,
    };
  });
}

/** レシート単位で「絶対払わざるを得ないもの」(固定費)を付け外しする。 */
export async function setTransactionMustPayAction(
  id: string,
  mustPay: boolean,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').update({ must_pay: mustPay }).eq('id', id);
    if (error) return { error: '変更できませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '変更できませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/reports');
  return { error: null };
}
