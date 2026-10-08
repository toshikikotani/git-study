/**
 * 目標(支出の計画)から、予測の範囲・予算・ジャンルの目標を作る。レポートとホームが同じ範囲で
 * 予測を出すため、ここ1か所で決める。範囲はすべての支出。期間は目標の期間。
 */

import type { ForecastScope } from '@/domain/forecast/pipeline';
import type { CategoryTarget } from '@/domain/forecast/simulate';
import type { SpendingPlan } from '@/features/spending-plan/store';
import type { DateOnly } from '@/lib/date';

export type GoalForecastArgs = {
  period: { from: DateOnly; to: DateOnly };
  budgetYen: number;
  scope: ForecastScope;
  categoryTargets: CategoryTarget[];
};

/** 目標の予算が 0 なら null(目標が無いのと同じ扱い)。 */
export function goalForecastArgs(plan: SpendingPlan | null): GoalForecastArgs | null {
  if (plan === null) return null;
  const items = plan.items.filter((item) => item.targetYen > 0);
  const budgetYen = items.reduce((sum, item) => sum + item.targetYen, 0);
  if (budgetYen <= 0) return null;
  return {
    period: { from: plan.periodStart, to: plan.periodEnd },
    budgetYen,
    scope: {},
    categoryTargets: items.map((item) => ({
      categoryId: item.genreId,
      categoryName: item.genreName,
      targetYen: item.targetYen,
    })),
  };
}
