'use server';

/**
 * `/transactions/new` の手入力高速化(N2)向け Server Action。
 * カテゴリ格子の再取得(並べ替え・非表示の反映)と、「いつもの」予測を扱う。
 */

import { fetchQuickEntryGenres, type QuickEntryGenre } from '@/features/genre/store';
import { fetchUsualEntryHistory } from '@/features/transactions/usual-entries';
import { suggestUsualEntries, type UsualEntryCandidate } from '@/domain/usual-entries';

export async function fetchQuickEntryGenresAction(): Promise<QuickEntryGenre[]> {
  return fetchQuickEntryGenres();
}

/** 「いつもの」予測(N2)。ジャンル名は genreNameById で解決する。 */
export async function suggestUsualEntriesAction(
  now: { weekday: number; hour: number },
  genreNameById: Record<string, string>,
): Promise<UsualEntryCandidate[]> {
  const history = await fetchUsualEntryHistory();
  const withNames = history.map((row) => ({
    ...row,
    genreName: row.genreId ? (genreNameById[row.genreId] ?? null) : null,
  }));
  return suggestUsualEntries(withNames, now, 3);
}
