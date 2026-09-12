/**
 * 給料日〜給料日の期間での使用金額の集計(FR-17, M6-3)。
 *
 * 保存は暦月のまま(ADR-015)。期間そのものの計算は `lib/date.ts` の
 * `paydayCycleFor()` が担い、ここは純粋な集計だけを行う。
 *
 * 集計から外すもの(domain/budget.ts の isCountable と揃える):
 *   - 口座間振替(isTransfer):お金が減っていないため
 *   - review_status = 'ignored':本人が対象外と判断した明細
 *   - 収入(amountYen > 0):使用金額に混ぜない
 */

export type PeriodTransaction = {
  accountId: string;
  categoryId: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
};

function isSpending(tx: PeriodTransaction): boolean {
  return !tx.isTransfer && tx.reviewStatus !== 'ignored' && tx.amountYen < 0;
}

/** 口座ごとの使用金額(円、正の数)。 */
export function sumByAccount(transactions: readonly PeriodTransaction[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (!isSpending(tx)) continue;
    map.set(tx.accountId, (map.get(tx.accountId) ?? 0) - tx.amountYen);
  }
  return map;
}

/** カテゴリごとの使用金額(円、正の数)。未分類(categoryId: null)もキーとして持つ。 */
export function sumByCategory(
  transactions: readonly PeriodTransaction[],
): Map<string | null, number> {
  const map = new Map<string | null, number>();
  for (const tx of transactions) {
    if (!isSpending(tx)) continue;
    map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) - tx.amountYen);
  }
  return map;
}

/** 期間全体の使用金額合計(円、正の数)。 */
export function totalSpending(transactions: readonly PeriodTransaction[]): number {
  return transactions.filter(isSpending).reduce((acc, tx) => acc - tx.amountYen, 0);
}
