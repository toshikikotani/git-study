'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from '../spending/category/[genreKey]/category-chart';
import {
  buildCumulative,
  categoryAllowanceYen,
  type RemainingForecast,
} from '@/features/category/pace';
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
  remaining,
}: {
  genreName: string;
  lines: CategoryLine[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  budgetYen: number;
  goalFrom: DateOnly;
  goalTo: DateOnly;
  remaining: RemainingForecast;
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
    // 予測の線と帯は、確率予測の「残りの支出」から描く(buildCumulative が日数に比例して足す)。
    const chart = buildCumulative({
      lines,
      monthStart,
      monthEnd,
      today,
      recordStart: series.recordStart,
      goal: { range: { from: goalFrom, to: goalTo }, budgetYen },
      remaining,
    });
    // 縦軸は予算ではなく、実績と予測の帯がちょうど収まる高さにする(予算より低い着地を見やすく)。
    const top = Math.max(
      1,
      ...chart.days.map((day) => Math.max(day.actualYen ?? 0, day.forecastHighYen ?? 0)),
    );
    return { ...chart, maxYen: top * 1.08, ticks: [top / 2, top] };
  }, [
    lines,
    monthStart,
    monthEnd,
    today,
    series.recordStart,
    goalFrom,
    goalTo,
    budgetYen,
    remaining,
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
