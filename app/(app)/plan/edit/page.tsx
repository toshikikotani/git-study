import { redirect } from 'next/navigation';

import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { remainingOfCategory } from '@/domain/forecast/remaining';
import { planPeriodDays } from '@/domain/spending-plan';
import { buildCategoryLines } from '@/features/category/model';
import { buildCumulative, linesForGoal } from '@/features/category/pace';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { loadGoalView } from '@/features/goals/loader';
import { listGenres } from '@/features/genre/store';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import { listGenreOptions } from '@/features/spending-plan/membership';
import { getCurrentPlan, listPlanRanges } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { addDays, daysBetween, todayJst } from '@/lib/date';
import { GoalEditor, type GoalCategory } from './goal-editor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 今期の目標(デザイン仕様書の「今期の目標」「カテゴリの目標額」、ADR-090):この目標で着地すると →
 * 期間 → 使っていい総額 → 提案 → カテゴリへの配分(押すとカテゴリの目標額)→ そのほか → 削除。
 * 数字は見通しと同じ、目標の期間の1つの確率予測から出す。
 */
export default async function GoalEditPage() {
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  if (plan === null) redirect('/plan');
  const period = { from: plan.periodStart, to: plan.periodEnd };
  const goal = goalForecastArgs(plan);
  const [ranges, genreOptions, loaded, genres, trend, ledger, view] = await Promise.all([
    listPlanRanges().catch(() => []),
    listGenreOptions().catch(() => []),
    loadForecast(goal ?? { period }).catch(() => null),
    listGenres().catch(() => []),
    loadCategorySpendingTrend().catch(() => null),
    loadLedgerTransactions(period, today).catch(() => null),
    loadGoalView().catch(() => null),
  ]);
  const forecast = loaded?.forecast ?? null;
  const closedGenreIds = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  const rows = forecast
    ? landingRowsFrom({
        forecast,
        excludedByCategory: loaded?.excludedByCategory ?? new Map(),
        closedGenreIds,
        cautionPrecision: loaded?.cautionPrecision ?? null,
        limit: Number.MAX_SAFE_INTEGER,
      })
    : [];
  const rowById = new Map(rows.map((row) => [row.genreId, row]));

  const monthKey = today.slice(0, 7);
  const previousMonthKey = trend?.monthKeys.filter((key) => key < monthKey).at(-1);
  const lastMonth = new Map(
    (trend?.rows ?? [])
      .filter((row) => row.monthKey === previousMonthKey)
      .map((row) => [row.categoryId, row.spentYen] as const),
  );

  const started = today >= period.from;
  const elapsedDays = started ? Math.max(1, daysBetween(period.from, today) + 1) : 1;
  const remainingDays = started
    ? Math.max(0, daysBetween(today, period.to) + 1)
    : planPeriodDays(period.from, period.to);
  const txs = (ledger?.transactions ?? []).map((tx) => ({ ...tx, items: [] }));

  const categories: GoalCategory[] = plan.items.map((item) => {
    const row = rowById.get(item.genreId);
    const remaining = forecast ? remainingOfCategory(forecast, item.genreId) : null;
    const days = buildCumulative({
      lines: linesForGoal(buildCategoryLines(txs, item.genreId, period, today), period),
      monthStart: period.from,
      monthEnd: period.to,
      today,
      recordStart: period.from,
      goal: { range: period, budgetYen: item.targetYen },
      remaining,
    }).days;
    let spent = 0;
    for (const d of days) if (d.actualYen !== null) spent = d.actualYen;
    const prev = lastMonth.get(item.genreId) ?? null;
    const p50 = row?.p50 ?? null;
    const caution = row?.caution ?? null;
    const sub = caution
      ? prev !== null && p50 !== null && p50 > prev * 1.3
        ? '先月より大きく増えそう'
        : 'このままだと目標をこえそう'
      : started && spent > 0
        ? `いまのペース 1日 約${Math.round(spent / elapsedDays).toLocaleString('ja-JP')}円`
        : (item.reason ?? null);
    return {
      genreId: item.genreId,
      name: item.genreName,
      targetYen: item.targetYen,
      spentYen: spent,
      lastMonthYen: prev,
      p10: row?.p10 ?? null,
      p50,
      p90: row?.p90 ?? null,
      caution: caution ? { probability: caution.probability } : null,
      sub,
      days,
    };
  });

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
      remainingDays={remainingDays}
      landing={
        forecast && forecast.probWithinBudget !== null
          ? { p50: forecast.total.p50, probWithin: forecast.probWithinBudget }
          : null
      }
      categories={categories}
      noBudget={view?.view && !view.view.ended ? view.view.noBudget : []}
      addable={genreOptions.filter((g) => !taken.has(g.genreId))}
      next={{ start: nextStart, reserved }}
    />
  );
}
