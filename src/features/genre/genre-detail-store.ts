/**
 * ホームの予算タイル1枠分の当月内訳(本人発案:「生活費って押したら一覧
 * みたいなん」を見れるようにしたい。ADR-057でカテゴリからジャンルへ)。
 *
 * ── ホームの数字と必ず一致させる ────────────────────────────
 * ここで出す使った額・残額は、features/home/summary.ts の buildHomeTiles()
 * が出す数字と同じでなければならない(タイルを押して開いた画面の合計が
 * タイル自体の数字と違うと、本人が数字を信じなくなる)。そのため集計ロジック
 * (domain/budget.ts の budgetStatusFor)は home/summary.ts の
 * listMonthTransactions() と同じ考え方をここでも使う。ジャンルに統廃合の
 * 概念は無い(categories.merged_into_id の廃止、ADR-057)ため、ここでの
 * 対象は genre_id の完全一致だけでよい。
 */

import { budgetStatusFor } from '@/domain/budget';
import { monthStartJst } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { GenreMonthDetail } from './genre-detail-types';

export type { GenreMonthDetail, GenreTransactionDetail } from './genre-detail-types';

export class GenreDetailError extends AppError {}

/**
 * 当月・1ジャンル分の内訳を返す。ジャンルが存在しない・本人のものでない
 * 場合は null(RLS が他人の行を返さないため、両者は同じ結果になる)。
 */
export async function loadGenreMonthDetail(
  genreId: string,
  now: Date = new Date(),
): Promise<GenreMonthDetail | null> {
  const supabase = await createClient();

  const { data: genre, error: genreError } = await supabase
    .from('genres')
    .select('id, name, budget_yen')
    .eq('id', genreId)
    .maybeSingle();
  if (genreError) {
    throw new GenreDetailError(`ジャンルを取得できませんでした: ${genreError.message}`);
  }
  if (!genre) return null;

  const monthStart = monthStartJst(0, now);
  const { data: rows, error: txError } = await supabase
    .from('transactions')
    .select(
      'id, occurred_on, description, merchant_name, amount_yen, is_transfer, review_status, genre_id',
    )
    .eq('genre_id', genreId)
    .gte('occurred_on', monthStart)
    .lt('occurred_on', monthStartJst(1, now))
    .order('occurred_on', { ascending: false });
  if (txError) throw new GenreDetailError(`明細を取得できませんでした: ${txError.message}`);

  const status = budgetStatusFor(
    { categoryId: genreId, budgetYen: genre.budget_yen, carryOverYen: 0 },
    rows.map((row) => ({
      categoryId: row.genre_id,
      amountYen: row.amount_yen,
      isTransfer: row.is_transfer,
      reviewStatus: row.review_status,
    })),
  );

  // 表の合計が status.spentYen と必ず一致するよう、集計対象外(振替・ignored)
  // は表示からも外す(isCountable() の判定を budgetStatusFor 側と揃える)。
  const transactions = rows
    .filter((row) => !row.is_transfer && row.review_status !== 'ignored')
    .map((row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      description: row.description,
      merchantName: row.merchant_name,
      amountYen: row.amount_yen,
    }));

  return { genreId, genreName: genre.name, status, transactions };
}
