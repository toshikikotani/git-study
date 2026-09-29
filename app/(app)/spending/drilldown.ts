import type { ReceiptItem } from '@/features/receipts/items-store';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import type { DrilldownTransaction } from './category-breakdown-chart';

/**
 * 明細1件分の共通の形(ジャンル別内訳・カレンダーの両方が使う)を作る。
 * 今月分は page.tsx が、過去・未来の月はカレンダーの Server Action が呼ぶ
 * ——同じ組み立てを複数箇所に書かない(ADR-033)。
 */
export function toDrilldownTransactions(
  ledgerTransactions: readonly LedgerTransaction[],
  itemsByTransactionId: ReadonlyMap<string, ReceiptItem[]>,
  expenseSubtypeByTransactionId: ReadonlyMap<string, string>,
): DrilldownTransaction[] {
  return ledgerTransactions.map((t) => ({
    id: t.id,
    occurredOn: t.occurredOn,
    label: t.label,
    genreId: t.genreId,
    genreName: t.genreName,
    amountYen: t.amountYen,
    accountId: t.accountId,
    paymentMethod: t.paymentMethod,
    items: itemsByTransactionId.get(t.id) ?? [],
    expenseSubtype: expenseSubtypeByTransactionId.get(t.id) ?? null,
  }));
}
