import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { toDrilldownTransactions } from './drilldown';
import { LedgerList } from './ledger-list';
import { SpendingMonthProvider } from './spending-month-provider';

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [ledger, genres, accounts, duplicates] = await withMinDuration(
    Promise.all([loadMonthlyLedger(), listGenres(), listAccounts(), listDuplicateCandidates()]),
  );
  const ids = ledger.transactions.map((t) => t.id);
  const [items, subtypes] = await Promise.all([
    listReceiptItemsForTransactionIds(ids),
    listExpenseSubtypesForTransactionIds(ids),
  ]);
  const transactions = toDrilldownTransactions(ledger.transactions, items, subtypes);

  return (
    <div className="rise space-y-3">
      <SpendingMonthProvider
        today={ledger.period.to}
        currentMonthStart={ledger.period.from}
        currentTransactions={transactions}
        currentGenreBreakdown={ledger.genreBreakdown}
        currentTotals={ledger.totals}
        genres={genres}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      >
        <LedgerList goalRange={null} duplicateCount={duplicates.length} />
      </SpendingMonthProvider>
    </div>
  );
}
