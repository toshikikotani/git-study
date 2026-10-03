'use client';

import { useMemo, useState } from 'react';

import {
  CategoryChart,
  type ChartMode,
} from '../spending/category/[genreKey]/category-chart';
import { buildCumulative, categoryAllowanceYen } from '@/features/category/pace';
import { buildSeries, type ChartUnit } from '@/features/category/series';
import type { CategoryLine } from '@/features/category/model';
import type { DateOnly } from '@/lib/date';

export function GoalChart({
  genreName,
  lines,
  monthStart,
  monthEnd,
  today,
  budgetYen,
  goalFrom,
  goalTo,
}: {
  genreName: string;
  lines: CategoryLine[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  budgetYen: number;
  goalFrom: DateOnly;
  goalTo: DateOnly;
}) {
  const [mode, setMode] = useState<ChartMode>('cumulative');
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [showPrevious, setShowPrevious] = useState(false);
  const series = useMemo(
    () =>
      buildSeries({
        lines,
        unit,
        monthStart,
        monthEnd,
        today,
        dailyAllowanceYen: categoryAllowanceYen({
          budgetYen,
          scheduledYen: 0,
          lines,
          goalRange: { from: goalFrom, to: goalTo },
          today,
        }),
      }),
    [lines, unit, monthStart, monthEnd, today, budgetYen, goalFrom, goalTo],
  );
  const cumulative = useMemo(
    () =>
      buildCumulative({
        lines,
        monthStart,
        monthEnd,
        today,
        recordStart: series.recordStart,
        goal: { range: { from: goalFrom, to: goalTo }, budgetYen },
      }),
    [lines, monthStart, monthEnd, today, series.recordStart, goalFrom, goalTo, budgetYen],
  );
  return (
    <CategoryChart
      series={series}
      cumulative={cumulative}
      mode={mode}
      onMode={setMode}
      genreName={genreName}
      monthLabel={`${monthStart.slice(0, 4)}年${Number(monthStart.slice(5, 7))}月`}
      showPrevious={showPrevious}
      onShowPrevious={setShowPrevious}
      onUnit={setUnit}
      onPick={() => undefined}
      selectedIndex={null}
      budgetYen={budgetYen}
    />
  );
}
