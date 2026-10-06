/**
 * レシートの品目(receipt_items、ADR-034)が、明細の合計と噛み合っているか。
 *
 * `domain/transaction-splits.ts` の「2件以上・合計一致」はカテゴリ分割の
 * 対象になれるかどうかの判定(features/import/receipt-ai.ts の
 * `itemsReconcileWithTotal()`)で、これとは別物。ここでの一致判定は
 * 1件だけの買い物にも適用する(1点だけでも金額が合っていれば「一致」)。
 */

import { AppError } from '@/lib/errors';

export type ReceiptItemsStatus = 'none' | 'reconciled' | 'mismatched';

export class ReceiptItemsError extends AppError {}

export function receiptItemsStatus(
  items: readonly { amountYen: number }[],
  totalAmountYen: number,
): ReceiptItemsStatus {
  if (items.length === 0) return 'none';
  const sum = items.reduce((acc, it) => acc + it.amountYen, 0);
  return sum === totalAmountYen ? 'reconciled' : 'mismatched';
}

/**
 * 手入力修正の保存前チェック。分割(`assertValidSplits`)と違い、
 * 「合計を一致させること」は強制しない(一致しないまま保存してよい設計、
 * 本人発案)。ここでは空文字の品名・0円の行だけを弾く。
 */
export function assertEditableReceiptItems(
  items: readonly { name: string; amountYen: number }[],
): void {
  for (const item of items) {
    if (item.name.trim() === '') {
      throw new ReceiptItemsError('品目の名前を入力してください。');
    }
    if (item.amountYen === 0) {
      throw new ReceiptItemsError('品目の金額は0円にできません。');
    }
  }
}
