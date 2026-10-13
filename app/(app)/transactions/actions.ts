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
import { recordCorrection } from '@/features/genre/memory-store';
import { assertDateOnly } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { describeUserError } from '@/lib/errors';

/**
 * レシート商品行から作った分割。呼び出し側は sourceRef を振っておき、
 * 保存後の実 id と対応付けて transaction_splits を作る。
 */
export type ReceiptSplitInput = {
  sourceRef: string;
  splits: TransactionSplitInput[];
};

/** レシートに写っていた商品行。 */
export type ReceiptItemsInput = {
  sourceRef: string;
  items: ReceiptItemInput[];
};

/** 「生活費」明細の小分類。 */
export type ReceiptExpenseSubtypeInput = {
  sourceRef: string;
  subtype: string;
};

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
  preview: readonly StoredTransaction[],
  meta: {
    fileName: string;
    source: TransactionSource;
    accountId: string;
    failedCount: number;
    receiptImagePath?: string | null;
  },
  receiptSplits: readonly ReceiptSplitInput[] = [],
  receiptItems: readonly ReceiptItemsInput[] = [],
  receiptExpenseSubtypes: readonly ReceiptExpenseSubtypeInput[] = [],
): Promise<{
  imported: number;
  duplicates: number;
  error: string | null;
  splitWarnings: string[];
  insertedIds: string[];
}> {
  let result;
  try {
    result = await importTransactions(preview, meta);
  } catch (error) {
    const message =
      error instanceof TransactionStoreError ? error.message : '取り込みに失敗しました。';
    return { imported: 0, duplicates: 0, error: message, splitWarnings: [], insertedIds: [] };
  }
  revalidatePath('/spending');

  const splitWarnings: string[] = [];
  if (receiptSplits.length > 0) {
    const splitsBySourceRef = new Map(receiptSplits.map((s) => [s.sourceRef, s.splits]));
    for (const inserted of result.insertedTransactions) {
      if (inserted.sourceRef === null) continue;
      const splits = splitsBySourceRef.get(inserted.sourceRef);
      if (!splits) continue;
      try {
        await replaceSplits(inserted.id, splits);
      } catch (error) {
        splitWarnings.push(describeUserError(error, '商品ごとの分割を保存できませんでした。'));
      }
    }
  }

  if (receiptItems.length > 0) {
    const itemsBySourceRef = new Map(receiptItems.map((s) => [s.sourceRef, s.items]));
    for (const inserted of result.insertedTransactions) {
      if (inserted.sourceRef === null) continue;
      const items = itemsBySourceRef.get(inserted.sourceRef);
      if (!items) continue;
      try {
        await replaceReceiptItems(inserted.id, items);
      } catch (error) {
        splitWarnings.push(describeUserError(error, '商品の記録を保存できませんでした。'));
      }
    }
  }

  if (receiptExpenseSubtypes.length > 0) {
    const subtypeBySourceRef = new Map(receiptExpenseSubtypes.map((s) => [s.sourceRef, s.subtype]));
    for (const inserted of result.insertedTransactions) {
      if (inserted.sourceRef === null) continue;
      const subtype = subtypeBySourceRef.get(inserted.sourceRef);
      if (!subtype) continue;
      try {
        await setExpenseSubtype(inserted.id, subtype);
      } catch (error) {
        splitWarnings.push(describeUserError(error, '生活費の小分類を保存できませんでした。'));
      }
    }
  }

  return {
    imported: result.importedCount,
    duplicates: result.duplicateCount,
    error: null,
    splitWarnings,
    insertedIds: result.insertedTransactions.map((t) => t.id),
  };
}

export async function updateTransactionAction(
  id: string,
  genreId: string | null,
  patch?: { amountAbsYen?: number; amountYen?: number; occurredOn?: string; isIncome?: boolean },
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    let storePatch: { amountYen: number; occurredOn: string } | undefined;
    if (patch) {
      const occurredOn = patch.occurredOn ? assertDateOnly(patch.occurredOn) : undefined;
      let amountYen = patch.amountYen;
      if (patch.amountAbsYen !== undefined) {
        const abs = assertYen(patch.amountAbsYen, '金額');
        if (abs <= 0) throw new MoneyError(`金額は正の値で指定してください: ${abs}`);
        amountYen = patch.isIncome ? abs : -abs;
      }
      if (amountYen !== undefined && occurredOn !== undefined) {
        storePatch = { amountYen, occurredOn };
      } else if (amountYen !== undefined) {
        storePatch = { amountYen, occurredOn: occurredOn ?? '' };
      }
    }
    await updateTransaction(id, genreId ?? '', storePatch);
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
    if (subtype !== null && subtype.trim() !== '') {
      await setExpenseSubtype(id, subtype);
    }
  } catch (error) {
    return { error: describeUserError(error, '更新できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

export async function checkReceiptDuplicatesAction(
  probes: readonly { key: string; storeName: string; occurredOn: string; amountYen: number }[],
): Promise<{
  duplicates: Record<string, { id: string; occurredOn: string; amountYen: number }[]>;
}> {
  const result: Record<string, { id: string; occurredOn: string; amountYen: number }[]> = {};
  try {
    const dates = [...new Set(probes.map((p) => assertDateOnly(p.occurredOn)))];
    if (dates.length === 0) return { duplicates: result };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('transactions')
      .select('id, occurred_on, description, merchant_name, amount_yen, review_status')
      .in('occurred_on', dates)
      .neq('review_status', 'ignored');
    if (error || !data) return { duplicates: result };
    const existing = data.map((r) => ({
      id: r.id,
      storeName: r.merchant_name ?? r.description,
      occurredOn: r.occurred_on,
      amountYen: r.amount_yen,
    }));
    for (const probe of probes) {
      const hits = findReceiptDuplicates(
        {
          storeName: probe.storeName,
          occurredOn: assertDateOnly(probe.occurredOn),
          amountYen: probe.amountYen,
        },
        existing,
      );
      if (hits.length > 0) {
        result[probe.key] = hits.map((h) => ({
          id: h.id,
          occurredOn: h.occurredOn,
          amountYen: h.amountYen,
        }));
      }
    }
  } catch {
    // ignore
  }
  return { duplicates: result };
}

export async function recordGenreCorrectionAction(input: {
  storeName: string;
  itemName: string;
  genreId: string;
  pin?: boolean;
  anyStore?: boolean;
}): Promise<{ error: string | null }> {
  try {
    await recordCorrection(input);
    return { error: null };
  } catch (error) {
    return { error: describeUserError(error, '分類の履歴を保存できませんでした。') };
  }
}

export async function undoReceiptSaveAction(
  ids: readonly string[],
): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').delete().in('id', [...ids]);
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
    const subtypes: Record<string, unknown>[] = [];
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
    const { error } = await supabase.from('transactions').insert(snapshot.row as never);
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
          occurred_on: row.occurred_on ?? '',
          note: row.note,
          kind: row.kind ?? undefined,
          reconcile_diff_yen: row.reconcile_diff_yen,
        } as never)
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
