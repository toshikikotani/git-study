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

/**
 * 変更前の値(Undo 用)。変更する前に読んで、変更の結果と一緒に返す。
 * 元に戻すときは restoreRowFieldsAction にそのまま渡す。
 */
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

/** 削除した明細の丸ごとの控え(Undo で同じ id のまま戻す)。 */
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
      kind: (row.kind as string | undefined) ?? null,
      reconcile_diff_yen: (row.reconcile_diff_yen as number | null | undefined) ?? null,
    };
  });
}

/**
 * レシート商品行から作った分割(本人発案)。呼び出し側(receipt/page.tsx)は
 * 分割したい行の StoredTransaction に一意な sourceRef を振っておき、ここで
 * 保存後の実 id と対応付けて transaction_splits を作る。
 *
 * B-7(transaction_splits マイグレーション未適用)の間はテーブルが無いため
 * 個別に失敗するが、明細そのものの取り込みは失敗させない(通常の1件として
 * 残る)。失敗は warnings にまとめて画面に見せる。
 */
export type ReceiptSplitInput = {
  sourceRef: string;
  splits: readonly TransactionSplitInput[];
};

/**
 * レシートに写っていた商品行(ADR-034)。カテゴリ分割(ReceiptSplitInput)とは
 * 独立していて、分割の対象になるかどうかに関わらず常に付く。sourceRef の
 * 仕組みは ReceiptSplitInput と同じ。
 */
export type ReceiptItemsInput = {
  sourceRef: string;
  items: readonly ReceiptItemInput[];
};

/**
 * 「生活費」明細の小分類(本人発案、ADR-036)。ReceiptItemsInput と同じ
 * sourceRef の仕組みで、保存後の実 id と対応付ける。カテゴリが実際に
 * 「生活費」かどうかはここでは判定しない(receipt-ai.ts はカテゴリ分類を
 * 行わないため)——常に保存しておき、表示側(/transactions)が明細の
 * カテゴリを見て出すかどうかを決める。
 */
export type ReceiptExpenseSubtypeInput = {
  sourceRef: string;
  subtype: string;
};

export async function saveImportBatchAction(
  preview: readonly StoredTransaction[],
  meta: {
    fileName: string;
    source: TransactionSource;
    accountId: string;
    failedCount: number;
    /** レシート撮影(本人発案)。features/import/receipt-storage.ts 参照。 */
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
  /** 今回新しく作られた明細の id(保存直後の「元に戻す」に使う)。 */
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

/**
 * 明細のジャンルを本人が直接直す(確認待ちキューを介さない、本人発案・
 * ADR-045)。ADR-057によりパターンルールの学習(classification_rules)は
 * 廃止したため、ここで学習ルールを作る経路は無い——本人の修正はこの明細
 * 1件だけに反映される(ジャンルはAIが基本、本人の修正も残す設計)。
 *
 * 金額・日付の補正(`patch`)は任意(本人発案「今金額と日付が一切編集
 * できない」、ADR-048)。amountAbsYen は正の大きさ(符号は本人に意識させ
 * ない、split-editor.tsx の分割入力と同じ設計)——ここで元の明細の収入/
 * 支出の符号(ADR-008)を掛けて揃える。
 */
export async function updateTransactionAction(
  id: string,
  genreId: string,
  patch?: { amountAbsYen: number; occurredOn: string; isIncome: boolean; description?: string },
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    let storePatch: { amountYen: number; occurredOn: string; description?: string } | undefined;
    if (patch) {
      const amountAbsYen = assertYen(patch.amountAbsYen, '金額');
      if (amountAbsYen <= 0) {
        throw new MoneyError(`金額は正の値で指定してください: ${amountAbsYen}`);
      }
      const occurredOn = assertDateOnly(patch.occurredOn);
      const description = patch.description?.trim();
      storePatch = {
        amountYen: patch.isIncome ? amountAbsYen : -amountAbsYen,
        occurredOn,
        ...(description ? { description } : {}),
      };
    }
    await updateTransaction(id, genreId, storePatch);
  } catch (error) {
    return { error: describeUserError(error, '更新に失敗しました。') };
  }
  revalidatePath('/spending');
  return { error: null, previous };
}

/**
 * 明細に自由記述のメモを付ける(本人発案、issue #95)。カテゴリ変更・分割
 * ・金額日付編集とは独立した操作のため、専用のServer Actionにした。
 */
export async function updateTransactionMemoAction(
  id: string,
  memo: string,
): Promise<{ error: string | null; previous?: RowFields[] }> {
  let previous: RowFields[] = [];
  try {
    previous = await readRowFields([id]);
    await updateTransactionMemo(id, memo);
  } catch (error) {
    return { error: describeUserError(error, 'メモの保存に失敗しました。') };
  }
  revalidatePath('/spending');
  return { error: null, previous };
}

/** 明細の複数カテゴリ分割を保存する(本人発案)。空配列を渡すと分割を解除する。 */
export async function replaceSplitsAction(
  transactionId: string,
  splits: readonly TransactionSplitInput[],
): Promise<{ error: string | null }> {
  try {
    await replaceSplits(transactionId, splits);
  } catch (error) {
    return { error: describeUserError(error, '分割の保存に失敗しました。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/**
 * レシートの品目を保存し直す(ADR-035)。合計が明細の金額と一致しない
 * ("mismatched")品目を、本人が手入力で直すために使う。
 */
export async function replaceReceiptItemsAction(
  transactionId: string,
  items: readonly ReceiptItemInput[],
): Promise<{ error: string | null }> {
  try {
    await replaceReceiptItems(transactionId, items);
  } catch (error) {
    return { error: describeUserError(error, '品目の保存に失敗しました。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/**
 * 生活費の小分類を保存する(本人発案、ADR-036)。既存の明細へ後から
 * レシートを紐付ける機能(P10-40、receipt-items-panel.tsx)専用の入口。
 * 家計簿(/spending、ADR-040)の明細一覧・ジャンル内訳の両方から呼ばれる。
 */
export async function setExpenseSubtypeAction(
  transactionId: string,
  subtype: string,
): Promise<{ error: string | null }> {
  try {
    await setExpenseSubtype(transactionId, subtype);
  } catch (error) {
    return { error: describeUserError(error, '生活費の小分類の保存に失敗しました。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/**
 * 保存前の重複警告(同じ店・同じ日・近い金額の取引が既にあるか)。
 * 警告だけで、保存は止めない(同じ店で同じ日に2回買うこともあるため、判断は本人)。
 */
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
    if (error) return { duplicates: result };
    const existing = data.map((r) => ({
      id: r.id,
      storeName: r.merchant_name ?? normalizeStoreName(r.description).name,
      occurredOn: r.occurred_on,
      amountYen: r.amount_yen,
    }));
    for (const probe of probes) {
      const hits = findReceiptDuplicates(probe, existing);
      if (hits.length > 0) {
        result[probe.key] = hits.map((h) => ({
          id: h.id,
          occurredOn: h.occurredOn,
          amountYen: h.amountYen,
        }));
      }
    }
  } catch {
    // 警告は補助。失敗しても保存を妨げない。
  }
  return { duplicates: result };
}

/** 利用者が直した品目のジャンルを、分類の履歴へ即座に反映する(pin=true でルール化)。 */
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

/**
 * 保存直後の「元に戻す」。今の保存で作った明細を消す(分割・品目は明細の削除で
 * 一緒に消える)。id は本人の行にだけ効く(RLS)。
 */
export async function undoReceiptSaveAction(
  ids: readonly string[],
): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('id', [...ids]);
    if (error) return { error: '元に戻せませんでした。明細から削除してください。' };
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/**
 * 明細を削除する(分割・品目は明細と一緒に消える)。消す前に丸ごと控えを取って返し、
 * restoreDeletedTransactionAction で同じ id のまま戻せる(Undo)。
 */
export async function deleteTransactionAction(
  id: string,
): Promise<{ error: string | null; snapshot?: DeletedSnapshot }> {
  let snapshot: DeletedSnapshot | undefined;
  try {
    const supabase = await createClient();
    const [{ data: row }, { data: splits }, { data: items }, { data: subtypes }] =
      await Promise.all([
        supabase.from('transactions').select('*').eq('id', id).maybeSingle(),
        supabase.from('transaction_splits').select('*').eq('transaction_id', id),
        supabase.from('receipt_items').select('*').eq('transaction_id', id),
        supabase.from('transaction_expense_subtypes').select('*').eq('transaction_id', id),
      ]);
    if (row) {
      snapshot = {
        row: row as unknown as Record<string, unknown>,
        splits: (splits ?? []) as unknown as Record<string, unknown>[],
        items: (items ?? []) as unknown as Record<string, unknown>[],
        subtypes: (subtypes ?? []) as unknown as Record<string, unknown>[],
      };
    }
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) return { error: '削除できませんでした。' };
  } catch (error) {
    return { error: describeUserError(error, '削除できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, ...(snapshot ? { snapshot } : {}) };
}

/** 削除の Undo。控えから、明細・分割・品目・小分類を同じ id で作り直す。 */
export async function restoreDeletedTransactionAction(
  snapshot: DeletedSnapshot,
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('transactions').insert(snapshot.row as never);
    if (error) return { error: '元に戻せませんでした。' };
    const children: [string, Record<string, unknown>[]][] = [
      ['transaction_splits', snapshot.splits],
      ['receipt_items', snapshot.items],
      ['transaction_expense_subtypes', snapshot.subtypes],
    ];
    for (const [table, rows] of children) {
      if (rows.length === 0) continue;
      const { error: childError } = await supabase
        .from(table as 'receipt_items')
        .insert(rows as never);
      if (childError) return { error: '元に戻せませんでした(品目・分割の一部)。' };
    }
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null };
}

/** 変更の Undo。変更前の値(RowFields)を書き戻す。 */
export async function restoreRowFieldsAction(
  rows: readonly RowFields[],
): Promise<{ error: string | null }> {
  try {
    const supabase = await createClient();
    for (const { id, kind, reconcile_diff_yen, ...fields } of rows) {
      const { error } = await supabase
        .from('transactions')
        .update({
          ...fields,
          ...(kind !== null ? { kind } : {}),
          reconcile_diff_yen,
        } as never)
        .eq('id', id);
      if (error) return { error: '元に戻せませんでした。' };
    }
  } catch (error) {
    return { error: describeUserError(error, '元に戻せませんでした。') };
  }
  revalidatePath('/spending');
  revalidatePath('/plan');
  return { error: null };
}

/**
 * 明細を複製する。同じ日・同じ金額・同じ摘要は重複排除の一意制約に当たるため、
 * 摘要に「(複製)」を付けて作る(あとから編集する前提)。分割・品目は複製しない。
 */
export async function duplicateTransactionAction(
  id: string,
): Promise<{ error: string | null; createdId?: string }> {
  let createdId: string | undefined;
  try {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !row) return { error: '複製できませんでした。' };
    const description = `${row.description}(複製)`;
    const { data: created, error: insertError } = await supabase
      .from('transactions')
      .insert({
        user_id: row.user_id,
        account_id: row.account_id,
        occurred_on: row.occurred_on,
        amount_yen: row.amount_yen,
        description,
        merchant_name: row.merchant_name,
        payment_method: row.payment_method,
        genre_id: row.genre_id,
        classified_by: row.classified_by,
        confidence: row.confidence,
        review_status: 'auto_ok',
        must_pay: row.must_pay,
        source: 'manual',
        fingerprint: fingerprintOf({
          occurredOn: row.occurred_on,
          amountYen: row.amount_yen,
          description,
        }),
      })
      .select('id')
      .single();
    if (insertError || !created)
      return { error: '複製できませんでした。すでに複製済みかもしれません。' };
    createdId = created.id;

    // 分割・品目も複製する(失敗しても複製した明細自体は残す)。
    const [{ data: splits }, { data: items }] = await Promise.all([
      supabase
        .from('transaction_splits')
        .select('genre_id, amount_yen, note')
        .eq('transaction_id', id),
      supabase
        .from('receipt_items')
        .select('name, amount_yen, sort_order, genre_id')
        .eq('transaction_id', id),
    ]);
    if (splits && splits.length > 0) {
      await supabase
        .from('transaction_splits')
        .insert(splits.map((x) => ({ ...x, user_id: row.user_id, transaction_id: created.id })));
    }
    if (items && items.length > 0) {
      await supabase
        .from('receipt_items')
        .insert(items.map((x) => ({ ...x, user_id: row.user_id, transaction_id: created.id })));
    }
  } catch (error) {
    return { error: describeUserError(error, '複製できませんでした。') };
  }
  revalidatePath('/spending');
  return { error: null, ...(createdId ? { createdId } : {}) };
}

/** 金額不一致の確認を済ませる(差額を認めて、要確認から外す)。 */
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

/** 明細を特別費(目標のペース計算から除く)にする/通常に戻す。列が本番に無い間はエラーを返す。 */
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
