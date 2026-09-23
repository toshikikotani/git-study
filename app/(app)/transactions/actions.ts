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
import { setExpenseSubtype } from '@/features/receipts/expense-subtype-store';
import { replaceReceiptItems, type ReceiptItemInput } from '@/features/receipts/items-store';
import {
  importTransactions,
  updateTransaction,
  TransactionStoreError,
  type StoredTransaction,
  type TransactionSource,
} from '@/features/transactions/store';
import { replaceSplits } from '@/features/transactions/splits-store';
import { describeUserError } from '@/lib/errors';

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
}> {
  let result;
  try {
    result = await importTransactions(preview, meta);
  } catch (error) {
    const message =
      error instanceof TransactionStoreError ? error.message : '取り込みに失敗しました。';
    return { imported: 0, duplicates: 0, error: message, splitWarnings: [] };
  }
  revalidatePath('/transactions');

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
  };
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
    return { error: describeUserError(error, '分割の保存に失敗しました。') };
  }
  revalidatePath('/transactions');
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
  revalidatePath('/transactions');
  revalidatePath('/spending');
  return { error: null };
}

/**
 * 生活費の小分類を保存する(本人発案、ADR-036)。既存の明細へ後から
 * レシートを紐付ける機能(P10-40、receipt-items-panel.tsx)専用の入口。
 * 明細一覧(/transactions)・家計簿のカテゴリ内訳(/spending、ADR-040)の
 * 両方から呼ばれる。
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
  revalidatePath('/transactions');
  revalidatePath('/spending');
  return { error: null };
}
