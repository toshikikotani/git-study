import { hourJst, parseDateOnlyOr, todayJst, weekdayOf } from '@/lib/date';
import { recentStoreNames } from '@/features/transactions/recent-stores';
import { fetchQuickEntryGenres } from '@/features/genre/store';
import { fetchUsualEntryHistory } from '@/features/transactions/usual-entries';
import { suggestUsualEntries } from '@/domain/usual-entries';
import { NewTransactionForm } from './new-transaction-form';

/**
 * 明細を手で登録する。`?date=YYYY-MM-DD` があれば、その日を日付の初期値にする
 * (家計簿のカレンダーの日付メニューから開く、本人発案)。形式が正しくない値は
 * 無視して今日にする。
 */
export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; type?: string | string[] }>;
}) {
  const { date, type } = await searchParams;
  const now = new Date();
  const quickEntryGenres = await fetchQuickEntryGenres(now);
  const genreNameById = Object.fromEntries(quickEntryGenres.map((g) => [g.id, g.name]));
  const history = await fetchUsualEntryHistory();
  const usualEntries = suggestUsualEntries(
    history.map((row) => ({
      ...row,
      genreName: row.genreId ? (genreNameById[row.genreId] ?? null) : null,
    })),
    { weekday: weekdayOf(todayJst(now)), hour: hourJst(now) },
    3,
  );

  return (
    <NewTransactionForm
      initialDate={parseDateOnlyOr(date, todayJst())}
      initialIncome={type === 'income'}
      recentStores={await recentStoreNames()}
      initialQuickEntryGenres={quickEntryGenres}
      usualEntries={usualEntries}
    />
  );
}
