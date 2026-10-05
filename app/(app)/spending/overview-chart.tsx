'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from './category/[genreKey]/category-chart';
import { formatYen } from '@/domain/money';
import { buildCategoryLines, scheduledYen, type CategoryTx } from '@/features/category/model';
import {
  buildCumulative,
  categoryAllowanceYen,
  idealDeltaLabel,
  linesForGoal,
} from '@/features/category/pace';
import { buildSeries, type ChartUnit } from '@/features/category/series';
import type { DateOnly } from '@/lib/date';

/**
 * 家計簿の全体の累計。目標があるときは、目標のジャンルだけを数える
 * (総予算は目標のジャンルの合計なので、目標にないジャンルを混ぜると食い違う)。
 */
export function OverviewChart({
  transactions,
  genreIds,
  monthStart,
  monthEnd,
  today,
  budgetYen,
  goalFrom,
  goalTo,
}: {
  transactions: CategoryTx[];
  genreIds: readonly string[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  budgetYen: number | null;
  goalFrom: DateOnly | null;
  goalTo: DateOnly | null;
}) {
  const [mode, setMode] = useState<ChartMode>('cumulative');
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [showPrevious, setShowPrevious] = useState(false);
  const goalRange = useMemo(
    () => (budgetYen !== null && goalFrom && goalTo ? { from: goalFrom, to: goalTo } : null),
    [budgetYen, goalFrom, goalTo],
  );
  const lines = useMemo(() => {
    const all = genreIds.flatMap((id) =>
      buildCategoryLines(transactions, id, { from: monthStart, to: monthEnd }, today),
    );
    return goalRange === null ? all : linesForGoal(all, goalRange);
  }, [transactions, genreIds, monthStart, monthEnd, today, goalRange]);
  const allowance =
    budgetYen !== null && goalRange !== null
      ? categoryAllowanceYen({
          budgetYen,
          scheduledYen: scheduledYen(lines),
          lines,
          goalRange,
          today,
        })
      : null;
  const series = useMemo(
    () =>
      buildSeries({
        lines,
        unit,
        monthStart,
        monthEnd,
        today,
        dailyAllowanceYen: allowance,
      }),
    [lines, unit, monthStart, monthEnd, today, allowance],
  );
  const cumulative = useMemo(
    () =>
      buildCumulative({
        lines,
        monthStart,
        monthEnd,
        today,
        recordStart: series.recordStart,
        goal: budgetYen !== null && goalRange !== null ? { range: goalRange, budgetYen } : null,
      }),
    [lines, monthStart, monthEnd, today, series.recordStart, budgetYen, goalRange],
  );
  const over = (cumulative.deltaYen ?? 0) > 0;
  const tone = over ? 'var(--over)' : 'var(--income)';
  return (
    <section aria-label="全体の累計" className="space-y-2">
      <p className="text-sm leading-relaxed" style={{ color: tone }}>
        {cumulative.deltaYen !== null ? idealDeltaLabel(cumulative.deltaYen) : '全体'}
        {allowance !== null ? `。今日から1日 ${formatYen(allowance, { sign: 'never' })}。` : ''}
      </p>
      <CategoryChart
        series={series}
        cumulative={cumulative}
        mode={mode}
        onMode={setMode}
        genreName="全体"
        monthLabel={`${Number(monthStart.slice(5, 7))}月`}
        showPrevious={showPrevious}
        onShowPrevious={setShowPrevious}
        onUnit={setUnit}
        onPick={() => undefined}
        selectedIndex={null}
        budgetYen={budgetYen}
      />
    </section>
  );
}
