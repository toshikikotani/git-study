/**
 * ホーム画面に出す3つの数字(FR-03, FR-14, FR-61)。
 *
 *   1. 貯金(貯金目標の進み具合。ADR-081 で「完済まで」から変えた)
 *   2〜3. 本人が選んだジャンルの残額(初期値は無し。本人が show_on_home を立てる)
 *
 * 数字は3個までに絞る。増やしたくなったら下層画面へ置くこと。
 * 「見るべきものが3つしかない」ことが、開き続けられる条件になる(FR-61)。
 *
 * ── 表示名をここに書かないこと(ADR-016、ADR-057でジャンルへ)──────────
 * どの枠を出すか(genres.show_on_home)も、何という名前で出すか
 * (genres.name)も、本人が変更できる。コードに日本語ラベルを
 * 直書きすると、本人が改名しても画面が変わらない。
 * ラベルは必ずデータから来る。
 *
 * ── データ源について(M0-3 以降)────────────────────────────
 * Supabase から実データを読む。RLS が本人の行だけに絞るので、
 * ここでは user_id を意識しない(ADR-011)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { budgetStatusFor, type BudgetTransaction, type CategoryBudget } from '@/domain/budget';
import { loadSavingsSummaryAsAdmin, type SavingsSummary } from '@/features/savings/store';
import { monthStartJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

/** ホームに並ぶ残額タイル1枚分。 */
export type HomeBudgetTile = {
  genreId: string;
  /** 画面に出す名前。本人が変更できる(genres.name)。 */
  label: string;
  budgetYen: number | null;
  spentYen: number;
  /** 予算未設定なら null。マイナスもありうる(超過)。 */
  remainingYen: number | null;
  usageRatio: number | null;
};

export type HomeSummary = {
  savings: SavingsSummary;
  /** show_on_home が立っているジャンル。FR-61 のため最大2件に切る。 */
  tiles: HomeBudgetTile[];
};

/** ホームに出す枠の上限。貯金と合わせて数字3個(FR-61)。 */
export const MAX_HOME_TILES = 2;

/** genres の1行のうち、ホーム表示に必要な部分。 */
export type HomeGenre = CategoryBudget & {
  name: string;
  sortOrder: number;
  showOnHome: boolean;
};

/**
 * ホームに出す残額タイルを組み立てる。
 *
 * 対象と並び順は本人の設定(show_on_home / sort_order)で決まる。
 * ここでジャンルを名指ししないことが、本人が枠を選び直せることの実体。
 */
export function buildHomeTiles(
  genres: readonly HomeGenre[],
  transactions: readonly BudgetTransaction[],
  limit: number = MAX_HOME_TILES,
): HomeBudgetTile[] {
  return genres
    .filter((genre) => genre.showOnHome)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((genre) => {
      const status = budgetStatusFor(genre, transactions);
      return {
        genreId: genre.categoryId,
        label: genre.name,
        budgetYen: status.budgetYen,
        spentYen: status.spentYen,
        remainingYen: status.remainingYen,
        usageRatio: status.usageRatio,
      };
    });
}

/**
 * ホームの3つの数字を組み立てる(管理クライアント版)。
 *
 * cron ジョブ(M5-2 の朝配信)には本人のセッションが無く RLS に頼れない
 * ため、user_id を明示して絞り込む。ホーム画面の表示と朝配信の冒頭2数字を
 * 必ず一致させる必要があるため、計算式はこちらの1本に集約する。
 */
export async function loadHomeSummaryAsAdmin(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<HomeSummary> {
  const [savings, genres] = await Promise.all([
    loadSavingsSummaryAsAdmin(client, userId, now),
    listHomeGenres(client, userId),
  ]);
  const transactions = await listMonthTransactions(
    client,
    userId,
    genres.map((g) => g.categoryId),
    now,
  );

  return {
    savings,
    tiles: buildHomeTiles(genres, transactions),
  };
}

export async function loadHomeSummary(now: Date = new Date()): Promise<HomeSummary> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new Error('ログイン状態を確認できませんでした');
  }
  return loadHomeSummaryAsAdmin(supabase, auth.user.id, now);
}

/** ホームに出す候補ジャンル(show_on_home = true)と、当月の予算額を組み立てる。 */
async function listHomeGenres(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<HomeGenre[]> {
  const { data: genres, error } = await client
    .from('genres')
    .select('id, name, budget_yen, sort_order, show_on_home')
    .eq('user_id', userId)
    .eq('show_on_home', true)
    .order('sort_order');
  if (error) throw new Error(`ジャンルを取得できませんでした: ${error.message}`);

  return genres.map((g) => ({
    categoryId: g.id,
    name: g.name,
    budgetYen: g.budget_yen,
    carryOverYen: 0,
    sortOrder: g.sort_order,
    showOnHome: g.show_on_home,
  }));
}

/** 当月・指定ジャンルの明細。集計から外すもの(振替・対象外)は domain/budget.ts 側で判定する。 */
async function listMonthTransactions(
  client: SupabaseClient<Database>,
  userId: string,
  genreIds: readonly string[],
  now: Date,
): Promise<BudgetTransaction[]> {
  if (genreIds.length === 0) return [];

  const { data, error } = await client
    .from('transactions')
    .select('genre_id, amount_yen, is_transfer, review_status')
    .eq('user_id', userId)
    .in('genre_id', genreIds)
    .gte('occurred_on', monthStartJst(0, now))
    .lt('occurred_on', monthStartJst(1, now));
  if (error) throw new Error(`明細を取得できませんでした: ${error.message}`);

  return data.map((t) => ({
    categoryId: t.genre_id,
    amountYen: t.amount_yen,
    isTransfer: t.is_transfer,
    reviewStatus: t.review_status,
  }));
}
