import { summarizeLedger } from '@/domain/ledger';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { toLedgerEntries } from '@/features/spending/views';
import { todayJst, type DateOnly } from '@/lib/date';
import { SpendingPlanStoreError } from './store';

/** 期間内で、今日より未来の明細をジャンルごとに合計する。 */
export async function loadScheduledByGenre(
  start: DateOnly,
  end: DateOnly,
): Promise<Map<string, number>> {
  const today = todayJst();
  let transactions;
  try {
    ({ transactions } = await loadLedgerTransactions({ from: start, to: end }, today));
  } catch (error) {
    throw new SpendingPlanStoreError(
      error instanceof Error ? error.message : '予定を取得できませんでした',
    );
  }
  const summary = summarizeLedger(toLedgerEntries(transactions), { from: start, to: end }, today);
  const byGenre = new Map<string, number>();
  for (const [genreId, yen] of summary.scheduledByGenre) {
    if (genreId !== null && yen > 0) byGenre.set(genreId, yen);
  }
  return byGenre;
}
