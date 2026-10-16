import { redirect } from 'next/navigation';

import { planPeriodDays } from '@/domain/spending-plan';
import { loadCategoryOutlooks } from '@/features/goals/category-outlook';
import { loadGoalView } from '@/features/goals/loader';
import { listGenreOptions } from '@/features/spending-plan/membership';
import { getCurrentPlan, listPlanRanges } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, todayJst } from '@/lib/date';
import { GoalEditor } from './goal-editor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 今期の目標(デザイン仕様書の⑥、ADR-090・091)。「分析 › 目標」の「編集」から開く。この目標で着地すると →
 * 期間 → 使っていい総額(使った額と予定が下限)→ 提案 → カテゴリへの配分(押すと⑦)→ そのほか → 削除。
 * 数字は「分析 › 目標」と同じ、目標の期間の1つの確率予測から出す。
 */
export default async function GoalEditPage() {
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  if (plan === null) redirect('/reports');
  const [ranges, genreOptions, loaded, view, fixedKeys] = await Promise.all([
    listPlanRanges().catch(() => []),
    listGenreOptions().catch(() => []),
    loadCategoryOutlooks({ plan, today }),
    loadGoalView().catch(() => null),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
  ]);
  const forecast = loaded.forecast?.forecast ?? null;
  const nextStart = addDays(plan.periodEnd, 1);
  const nextEnd = addDays(nextStart, planPeriodDays(plan.periodStart, plan.periodEnd) - 1);
  const reserved = ranges.some(
    (r) => r.id !== plan.id && r.periodStart <= nextEnd && r.periodEnd >= nextStart,
  );
  const taken = new Set(plan.items.filter((i) => i.targetYen > 0).map((i) => i.genreId));

  return (
    <GoalEditor
      planId={plan.id}
      periodStart={plan.periodStart}
      periodEnd={plan.periodEnd}
      today={today}
      remainingDays={loaded.remainingDays}
      landing={
        forecast && forecast.probWithinBudget !== null
          ? { p50: forecast.total.p50, probWithin: forecast.probWithinBudget }
          : null
      }
      categories={loaded.outlooks}
      noBudget={view?.view && !view.view.ended ? view.view.noBudget : []}
      addable={genreOptions.filter((g) => !taken.has(g.genreId))}
      next={{ start: nextStart, reserved }}
      settings={Object.fromEntries(
        loaded.genres.map((g) => [
          g.id,
          { isFixed: fixedKeys.has(`genre:${g.id}`), showOnHome: g.showOnHome },
        ]),
      )}
    />
  );
}
