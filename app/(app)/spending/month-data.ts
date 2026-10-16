import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { toDrilldownTransactions } from './drilldown';

/**
 * 明細と分析が共通で使う、今月の明細とその材料(SpendingMonthProvider に渡す分)。
 * 月を切り替えたあとの月は、provider が actions.ts から読み直す。
 */
export async function loadSpendingMonthData() {
  const [ledger, genres, accounts, captures] = await Promise.all([
    loadMonthlyLedger(),
    listGenres(),
    listAccounts(),
    listOpenCaptures().catch(() => []),
  ]);
  const ids = ledger.transactions.map((t) => t.id);
  const [items, subtypes] = await Promise.all([
    listReceiptItemsForTransactionIds(ids),
    listExpenseSubtypesForTransactionIds(ids),
  ]);
  return {
    ledger,
    genres,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    captures,
    transactions: toDrilldownTransactions(ledger.transactions, items, subtypes),
  };
}
