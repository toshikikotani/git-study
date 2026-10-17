'use server';

import { listGenres } from '@/features/genre/store';
import {
  MAX_WHAT_IF_AMOUNTS,
  MAX_WHAT_IF_YEN,
  simulateTodaySpends,
  type WhatIfSpend,
} from '@/features/forecast/what-if-spend';
import { describeUserError } from '@/lib/errors';

/**
 * もし今日これだけ使ったら(デザイン v3-2、ADR-108)。試す額をまとめて受け取り、ホームと同じ予測で
 * 前 → 後を返す(チップを押し替えるたびに待たせない)。何も記録しない。
 */
export async function simulateSpendAction(
  amounts: readonly number[],
  genreId: string | null,
): Promise<{ result: WhatIfSpend | null; error: string | null }> {
  if (
    !Array.isArray(amounts) ||
    amounts.length === 0 ||
    amounts.length > MAX_WHAT_IF_AMOUNTS ||
    amounts.some((a) => !Number.isInteger(a) || a < 1 || a > MAX_WHAT_IF_YEN)
  ) {
    return { result: null, error: '試す額は1円から100万円までで入れてください。' };
  }
  try {
    const genres = genreId === null ? [] : await listGenres();
    const genre = genreId === null ? null : (genres.find((g) => g.id === genreId) ?? null);
    const result = await simulateTodaySpends(
      amounts,
      genre ? { id: genre.id, name: genre.name } : null,
    );
    return { result, error: null };
  } catch (error) {
    return { result: null, error: describeUserError(error, '見通しを計算できませんでした。') };
  }
}
