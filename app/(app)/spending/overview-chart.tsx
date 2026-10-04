'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from './category/[genreKey]/category-chart';
import { formatYen } from '@/domain/money';
import { buildCategoryLines, type CategoryTx } from '@/features/category/model';
import { buildCumulative, categoryAllowanceYen, idealDeltaLabel } from '@/features/category/pace';
import { buildSeries, type ChartUnit } from '@/features/category/series';
import type { DateOnly } from '@/lib/date';

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
  const lines = useMemo(
    () =>
      genreIds.flatMap((id) =>
        buildCategoryLines(transactions, id, { from: monthStart, to: monthEnd }, today),
      ),
    [transactions, genreIds, monthStart, monthEnd, today],
  );
  const allowance =
    budgetYen !== null && goalFrom && goalTo
      ? categoryAllowanceYen({
          budgetYen,
          scheduledYen: 0,
          lines,
          goalRange: { from: goalFrom, to: goalTo },
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
        goal:
          budgetYen !== null && goalFrom && goalTo
            ? { range: { from: goalFrom, to: goalTo }, budgetYen }
            : null,
      }),
    [lines, monthStart, monthEnd, today, series.recordStart, budgetYen, goalFrom, goalTo],
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
