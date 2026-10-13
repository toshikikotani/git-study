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
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .in('id', [...ids]);
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

export async function saveImportBatchAction(
  source: TransactionSource,
  transactions: StoredTransaction[],
): Promise<{ error: string | null; batchId?: string }> {
  try {
    const batchId = await importTransactions(source, transactions);
    return { error: null, batchId };
  } catch (error) {
    return { error: describeUserError(error, '取り込みできませんでした。') };
  }
}

export async function updateTransactionAction(
  id: string,
  genreId: string | null,
  fields: { amountYen?: number; occurredOn?: string },
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    await updateTransaction(id, genreId, fields);
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, previous };
}

export async function updateTransactionMemoAction(
  id: string,
  memo: string,
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    await updateTransactionMemo(id, memo);
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, previous };
}

export async function replaceSplitsAction(
  id: string,
  splits: TransactionSplitInput[],
): Promise<{ error: string | null }> {
  try {
    await replaceSplits(id, splits);
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function replaceReceiptItemsAction(
  id: string,
  items: ReceiptItemInput[],
): Promise<{ error: string | null }> {
  try {
    await replaceReceiptItems(id, items);
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function setExpenseSubtypeAction(
  id: string,
  subtype: string | null,
): Promise<{ error: string | null }> {
  try {
    await setExpenseSubtype(id, subtype);
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function checkReceiptDuplicatesAction(
  fingerprints: string[],
): Promise<{ duplicates: string[] }> {
  try {
    const duplicates = await findReceiptDuplicates(fingerprints);
    return { duplicates };
  } catch {
    return { duplicates: [] };
  }
}

export async function recordGenreCorrectionAction(input: {
  storeName: string;
  genreId: string;
}): Promise<{ error: string | null }> {
  try {
    await recordCorrection(normalizeStoreName(input.storeName), input.genreId);
  } catch (error) {
    return { error: describeUserError(error, '記録できませんでした。') };
  }
  return { error: null };
}

export async function undoReceiptSaveAction(
  snapshot: DeletedSnapshot,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').insert(snapshot.row);
    if (error) return { error: '元に戻せませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function deleteTransactionAction(
  id: string,
): Promise<{ error: string | null; snapshot?: DeletedSnapshot }> {
  try {
    const supabase = await createClient();
    const { data: row } = await supabase.from('transactions').select('*').eq('id', id).single();
    if (!row) return { error: '見つかりませんでした。' };
    const { data: splits } = await supabase
      .from('transaction_splits')
      .select('*')
      .eq('transaction_id', id);
    const { data: items } = await supabase
      .from('receipt_items')
      .select('*')
      .eq('transaction_id', id);
    const { data: subtypes } = await supabase
      .from('expense_subtypes')
      .select('*')
      .eq('transaction_id', id);
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return { error: '削除できませんでした。' };
    return {
      error: null,
      snapshot: {
        row,
        splits: splits ?? [],
        items: items ?? [],
        subtypes: subtypes ?? [],
      },
    };
  } catch (error) {
    return { error: describeUserError(error, '削除できませんでした。') };
  }
}

export async function restoreDeletedTransactionAction(
  snapshot: DeletedSnapshot,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').insert(snapshot.row);
    if (error) return { error: '元に戻せませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function restoreRowFieldsAction(
  previous: RowFields[],
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    for (const row of previous) {
      const { error } = await supabase
        .from('transactions')
        .update({
          genre_id: row.genre_id,
          classified_by: row.classified_by,
          review_status: row.review_status,
          reviewed_at: row.reviewed_at,
          amount_yen: row.amount_yen,
          occurred_on: row.occurred_on,
          note: row.note,
          kind: row.kind,
          reconcile_diff_yen: row.reconcile_diff_yen,
        })
        .eq('id', row.id);
      if (error) return { error: '元に戻せませんでした。' };
    }
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function duplicateTransactionAction(
  id: string,
): Promise<{ error: string | null; createdId?: string }> {
  let createdId: string | undefined;
  try {
    const supabase = await createClient();
    const { data: row } = await supabase.from('transactions').select('*').eq('id', id).single();
    if (!row) return { error: '見つかりませんでした。' };
    const { id: _, ...rest } = row;
    const { data: created, error } = await supabase
      .from('transactions')
      .insert({ ...rest, occurred_on: assertDateOnly(rest.occurred_on) })
      .select('id')
      .single();
    if (error || !created) return { error: '複製できませんでした。' };
    createdId = created.id;
  } catch (error) {
    return { error: describeUserError(error, '複製できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, ...(createdId ? { createdId } : {}) };
}

export async function resolveReconcileAction(
  ids: readonly string[],
): Promise<{ error: string | null; previous?: RowFields[] }> {
  if (ids.length === 0) return { error: null };
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields(ids);
    const supabase = await createClient();
    const { error } = await supabase
      .from('transactions')
      .update({ reconcile_diff_yen: null })
      .in('id', [...ids]);
    if (error) return { error: '更新できませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, previous };
}

export async function setTransactionKindAction(
  id: string,
  kind: 'normal' | 'special',
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').update({ kind }).eq('id', id);
    if (error)
      return { error: '変更できませんでした(マイグレーションの適用が必要かもしれません)。' };
  } catch (error) {
    return { error: describeUserError(error, '変更できませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null, previous };
}

/** レシート単位で「絶対払わざるを得ないもの」(固定費)を付け外しする。 */
export async function setTransactionMustPayAction(
  id: string,
  mustPay: boolean,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('transactions')
      .update({ must_pay: mustPay })
      .eq('id', id);
    if (error) return { error: '変更できませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '変更できませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/reports');
  return { error: null };
}
