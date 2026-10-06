import type { ReceiptItem } from '@/features/receipts/items-store';
import type { LedgerTransaction } from '@/features/spending/ledger-types';

/**
 * 家計簿の明細1件分(明細リスト・カレンダー・要確認が共有する形)。
 * 集計済みの LedgerTransaction に、レシートの品目と生活費の小分類を添えたもの。
 * 今月分は page.tsx が、過去・未来の月はカレンダーの Server Action が作る
 * ——同じ組み立てを複数箇所に書かない(ADR-033)。
 */
export type DrilldownTransaction = LedgerTransaction & {
  items: readonly ReceiptItem[];
  expenseSubtype: string | null;
};

export function toDrilldownTransactions(
  ledgerTransactions: readonly LedgerTransaction[],
  itemsByTransactionId: ReadonlyMap<string, ReceiptItem[]>,
  expenseSubtypeByTransactionId: ReadonlyMap<string, string>,
): DrilldownTransaction[] {
  return ledgerTransactions.map((t) => ({
    ...t,
    items: itemsByTransactionId.get(t.id) ?? [],
    expenseSubtype: expenseSubtypeByTransactionId.get(t.id) ?? null,
  }));
}
