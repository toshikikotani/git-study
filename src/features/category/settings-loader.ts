/**
 * カテゴリの設定ページの読み込み(サーバー)。明細は読まず、設定に要るものだけを集める。
 */

import { loadGoalView } from '@/features/goals/loader';
import { listGenres } from '@/features/genre/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';

export type CategorySettingsData = {
  genreName: string;
  /** ほかのカテゴリ(使われている色を避けるため)。 */
  genres: { id: string; name: string }[];
  /** 目標が無いときの月の目安(genres.budget_yen)。 */
  genreBudgetYen: number | null;
  isFixed: boolean;
  forecastClosed: boolean;
  goal: null | {
    /** 進行中の目標の配分。目標の期間中だけ入る。 */
    plan: null | {
      id: string;
      periodStart: string;
      periodEnd: string;
      rows: {
        genreId: string;
        genreName: string;
        baselineYen: number | null;
        note: string | null;
        yen: number;
      }[];
    };
  };
};

export async function loadCategorySettings(
  genreId: string,
  now: Date = new Date(),
): Promise<CategorySettingsData | null> {
  const [genres, fixedKeys, goalLoaded] = await Promise.all([
    listGenres(),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    loadGoalView(now).catch(() => null),
  ]);
  const genre = genres.find((g) => g.id === genreId);
  if (genre === undefined) return null;
  return {
    genreName: genre.name,
    genres: genres.map((g) => ({ id: g.id, name: g.name })),
    genreBudgetYen: genre.budgetYen,
    isFixed: fixedKeys.has(`genre:${genreId}`),
    forecastClosed: genre.forecastClosed,
    goal:
      goalLoaded === null
        ? null
        : {
            plan: goalLoaded.view.active
              ? {
                  id: goalLoaded.plan.id,
                  periodStart: goalLoaded.plan.periodStart,
                  periodEnd: goalLoaded.plan.periodEnd,
                  rows: goalLoaded.plan.items.map((item) => ({
                    genreId: item.genreId,
                    genreName: item.genreName,
                    baselineYen: null,
                    note: item.reason,
                    yen: item.targetYen,
                  })),
                }
              : null,
          },
  };
}
