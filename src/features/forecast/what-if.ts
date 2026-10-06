/**
 * ジャンル画面の「もし、へらしたら」(設計書のジャンルの試算)の読み込み(サーバー)。
 *
 * 目標の期間中で、このジャンルが目標に入っていれば、ホーム・レポートと同じ目標の範囲の予測から
 * 出す(全体で予算に収まる確率が、ホームの数字と一致する)。目標の外なら今月のすべての支出の
 * 予測から出し、ジャンルの予算を目標として使う。月末の収支は、今月のすべての支出の予測の収支に、
 * へらしたぶんを足した目安。
 */

import type { ForecastWhatIfOption } from '@/domain/forecast/types';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { addDays, addMonths, monthStartJst, todayJst, type DateOnly } from '@/lib/date';
import { goalForecastArgs } from './goal';
import { loadForecast } from './load';

export type CategoryWhatIfView = {
  categoryName: string;
  /** 1回あたりの見込みの額と、残りの週数(「1回 約3,100円 × 残り約3.7週」)。 */
  perVisitYen: number;
  weeks: number;
  /** ジャンルの目標(目標の配分、無ければジャンルの予算)。 */
  targetYen: number | null;
  /** 全体の予算(目標の範囲のとき)。 */
  budgetYen: number | null;
  /** 今月のすべての支出での月末の収支の見込み(中央)。収入が分からなければ null。 */
  balanceP50: number | null;
  options: readonly ForecastWhatIfOption[];
  provisional: boolean;
};

export async function loadCategoryWhatIf(input: {
  genreId: string;
  genreName: string;
  genreBudgetYen: number | null;
  now?: Date;
}): Promise<CategoryWhatIfView | null> {
  const now = input.now ?? new Date();
  const today = todayJst(now);
  const monthFrom = monthStartJst(0, now);
  const monthPeriod: { from: DateOnly; to: DateOnly } = {
    from: monthFrom,
    to: addDays(addMonths(monthFrom, 1), -1),
  };
  const plan = await getCurrentPlan(today).catch(() => null);
  const goal = goalForecastArgs(plan);
  const inGoal =
    goal !== null &&
    goal.scope.genreIds?.has(input.genreId) === true &&
    goal.period.from <= today &&
    today <= goal.period.to;

  // 目標の範囲で出すときは、今月の予測は収支にだけ使う(ジャンルの目標を渡すと、目標ごとの
  // 注意の検証が別に走って重くなるため渡さない)。
  const monthTargets =
    !inGoal && input.genreBudgetYen !== null && input.genreBudgetYen > 0
      ? [
          {
            categoryId: input.genreId,
            categoryName: input.genreName,
            targetYen: input.genreBudgetYen,
          },
        ]
      : undefined;
  const [view, monthView] = await Promise.all([
    inGoal ? loadForecast({ ...goal, now }) : Promise.resolve(null),
    loadForecast({
      period: monthPeriod,
      now,
      ...(monthTargets ? { categoryTargets: monthTargets } : {}),
    }),
  ]);
  const source = view ?? monthView;
  const whatIf = source.forecast.whatIf.find((w) => w.categoryId === input.genreId);
  if (whatIf === undefined || whatIf.options.length < 2) return null;
  const row = source.forecast.byCategory.find((c) => c.categoryId === input.genreId);
  const balance = monthView.forecast.balance;
  return {
    categoryName: whatIf.categoryName,
    perVisitYen: whatIf.perVisitYen,
    weeks: whatIf.weeks,
    targetYen: row?.targetYen ?? null,
    budgetYen: inGoal ? goal.budgetYen : null,
    balanceP50: balance === null ? null : balance.p50,
    options: whatIf.options,
    provisional: source.forecast.provisional,
  };
}
