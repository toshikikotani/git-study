'use server';

/**
 * 手入力のカテゴリ格子(N2、manual-entry-form.tsx の quick variant)の
 * 長押しメニュー向け Server Action。`/transactions/new` と将来の他の手入力
 * 画面から共通で使う(ManualEntryForm 自体が共有部品のため)。
 */

import {
  fetchQuickEntryGenreSettings,
  GenreStoreError,
  reorderQuickEntryGenres,
  setGenreQuickEntryHidden,
  type QuickEntryGenreSetting,
} from '@/features/genre/store';

export async function fetchQuickEntryGenreSettingsAction(): Promise<QuickEntryGenreSetting[]> {
  return fetchQuickEntryGenreSettings();
}

export async function reorderQuickEntryGenresAction(
  orderedIds: string[],
): Promise<{ error: string | null }> {
  try {
    await reorderQuickEntryGenres(orderedIds);
  } catch (error) {
    return { error: error instanceof GenreStoreError ? error.message : '保存できませんでした。' };
  }
  return { error: null };
}

export async function setQuickEntryGenreHiddenAction(
  id: string,
  hidden: boolean,
): Promise<{ error: string | null }> {
  try {
    await setGenreQuickEntryHidden(id, hidden);
  } catch (error) {
    return { error: error instanceof GenreStoreError ? error.message : '保存できませんでした。' };
  }
  return { error: null };
}
