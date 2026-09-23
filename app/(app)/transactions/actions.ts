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
import type { PaymentMethod } from '@/features/import/adapters';
import {
  fingerprintOf,
  importTransactions,
  updateTransaction,
  updateTransactionDate,
  TransactionStoreError,
  type StoredTransaction,
  type TransactionSource,
} from '@/features/transactions/store';
import { replaceSplits, TransactionSplitStoreError } from '@/features/transactions/splits-store';

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
        splitWarnings.push(
          error instanceof TransactionSplitStoreError
            ? error.message
            : '商品ごとの分割を保存できませんでした。',
        );
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

/**
 * 明細の日付を直す(本人発案)。レシート撮影直後のプレビューは
 * receipt/page.tsx がローカルの state で直すため保存前はここを通らないが、
 * 一度保存された明細(取り込み後、あるいは手動登録した明細)を後から直す
 * 経路がここまで無かった。
 */
export async function updateTransactionDateAction(
  id: string,
  occurredOn: string,
): Promise<{ error: string | null }> {
  try {
    await updateTransactionDate(id, occurredOn);
  } catch (error) {
    return {
      error:
        error instanceof TransactionStoreError ? error.message : '日付を更新できませんでした。',
    };
  }
  revalidatePath('/transactions');
  revalidatePath('/transactions/review');
  return { error: null };
}

/**
 * 手動での明細登録(本人発案)。現金・電子マネー以外にも、レシートを
 * 撮り忘れた・撮れない支払い(口頭で分かっている金額など)を直接1件だけ
 * 記録したいという要望。取り込み経路(CSV・レシート等)と同じ
 * `importTransactions()` にそのまま乗せる——`transaction_source` は
 * ADR-021 の時点で `manual` を流用する方針が既に決まっており(取り込み元
 * での見分けは無いが `transactions` の内容自体は正しく記録される)、
 * ここも新しい値を増やさずそれに従う。カテゴリを選べば本人が確定させた
 * ことになる(classified_by='manual', review_status='confirmed')。選ばなければ
 * 確認待ちキュー(/transactions/review)に他の未分類明細と同じように出る。
 */
export async function createManualTransactionAction(input: {
  occurredOn: string;
  description: string;
  amountYen: number;
  paymentMethod: PaymentMethod;
  accountId: string;
  categoryId: string | null;
}): Promise<{ error: string | null }> {
  const description = input.description.trim();
  if (description === '') {
    return { error: '内容を入力してください。' };
  }
  if (!Number.isFinite(input.amountYen) || input.amountYen === 0) {
    return { error: '金額を入力してください。' };
  }

  const transaction: StoredTransaction = {
    id: crypto.randomUUID(),
    accountId: input.accountId,
    occurredOn: input.occurredOn,
    description,
    merchantName: null,
    amountYen: input.amountYen,
    paymentMethod: input.paymentMethod,
    categoryId: input.categoryId,
    categoryName: null,
    matchedRuleId: null,
    classifiedBy: input.categoryId ? 'manual' : 'unclassified',
    confidence: null,
    reviewStatus: input.categoryId ? 'confirmed' : 'pending',
    source: 'manual',
    fingerprint: fingerprintOf({
      occurredOn: input.occurredOn,
      amountYen: input.amountYen,
      description,
    }),
    batchId: null,
    sourceRef: null,
  };

  try {
    await importTransactions([transaction], {
      fileName: null,
      source: 'manual',
      accountId: input.accountId,
      failedCount: 0,
    });
  } catch (error) {
    return {
      error: error instanceof TransactionStoreError ? error.message : '登録できませんでした。',
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
