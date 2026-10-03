'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from '../spending/category/[genreKey]/category-chart';
import type { GoalRange } from '@/domain/goal-range';
import { buildCumulative, categoryAllowanceYen } from '@/features/category/pace';
import type { CategoryLine } from '@/features/category/model';
import { buildSeries, type ChartUnit } from '@/features/category/series';
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
  range,
}: {
  genreName: string;
  lines: CategoryLine[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  budgetYen: number;
  goalFrom: DateOnly;
  goalTo: DateOnly;
  range: GoalRange;
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
  const cumulative = useMemo(() => {
    const chart = buildCumulative({
      lines,
      monthStart,
      monthEnd,
      today,
      recordStart: series.recordStart,
      goal: { range: { from: goalFrom, to: goalTo }, budgetYen },
    });
    const future = chart.days.filter((day) => day.forecastYen !== null);
    const last = future.length - 1;
    return {
      ...chart,
      hasForecast: future.length > 0,
      maxYen: Math.max(chart.maxYen, range.highYen, budgetYen),
      days: chart.days.map((day) => {
        if (day.forecastYen === null) return day;
        const step = last <= 0 ? 1 : future.indexOf(day) / last;
        return {
          ...day,
          forecastYen: Math.round(range.spentYen + (range.pointYen - range.spentYen) * step),
          forecastLowYen: Math.round(range.spentYen + (range.lowYen - range.spentYen) * step),
          forecastHighYen: Math.round(range.spentYen + (range.highYen - range.spentYen) * step),
        };
      }),
    };
  }, [lines, monthStart, monthEnd, today, series.recordStart, goalFrom, goalTo, budgetYen, range]);
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
      budgetYen={null}
    />
  );
}
