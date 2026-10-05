'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from '../spending/category/[genreKey]/category-chart';
import { buildCumulative, categoryAllowanceYen } from '@/features/category/pace';
import { scheduledYen, type CategoryLine } from '@/features/category/model';
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
  landing,
}: {
  genreName: string;
  lines: CategoryLine[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  budgetYen: number;
  goalFrom: DateOnly;
  goalTo: DateOnly;
  landing: { p10: number; p50: number; p90: number };
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
          scheduledYen: scheduledYen(lines),
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
    const future = chart.days.filter((day) => day.date > today);
    const start = chart.days.find((day) => day.date === today)?.actualYen ?? 0;
    const scheduledTotal = future.reduce((sum, day) => sum + day.scheduledYen, 0);
    const variable = Math.max(landing.p50 - start - scheduledTotal, 0);
    const openDays = Math.max(future.filter((day) => day.scheduledYen === 0).length, 1);
    let scheduled = 0;
    let varied = 0;
    const path = new Map<string, number>();
    for (const day of future) {
      scheduled += day.scheduledYen;
      if (day.scheduledYen === 0) varied += variable / openDays;
      path.set(day.date, start + scheduled + varied);
    }
    const end = path.get(future.at(-1)?.date ?? '') ?? start;
    const lowGap = landing.p10 - landing.p50;
    const highGap = landing.p90 - landing.p50;
    return {
      ...chart,
      hasForecast: future.length > 0,
      maxYen: Math.max(landing.p90, landing.p50, end, 1) * 1.08,
      ticks: [Math.max(landing.p90, end, 1) / 2, Math.max(landing.p90, end, 1)],
      days: chart.days.map((day) => {
        const point = path.get(day.date);
        if (point === undefined) return day;
        const scale = end === start ? 1 : (point - start) / (end - start);
        const lastDay = day.date === future.at(-1)?.date;
        return {
          ...day,
          forecastYen: lastDay ? landing.p50 : Math.round(point),
          forecastLowYen: lastDay ? landing.p10 : Math.round(point + lowGap * scale),
          forecastHighYen: lastDay ? landing.p90 : Math.round(point + highGap * scale),
        };
      }),
    };
  }, [
    lines,
    monthStart,
    monthEnd,
    today,
    series.recordStart,
    goalFrom,
    goalTo,
    budgetYen,
    landing,
  ]);
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
