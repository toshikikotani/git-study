'use client';

import { useMemo, useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { CategoryChart, type ChartMode } from '../spending/category/[genreKey]/category-chart';
import {
  buildCumulative,
  categoryAllowanceYen,
  type RemainingForecast,
} from '@/features/category/pace';
import { scheduledYen, type CategoryLine } from '@/features/category/model';
import { buildSeries, type ChartUnit } from '@/features/category/series';
import type { DateOnly } from '@/lib/date';

/** 「全体」と「変えられる支出だけ」(決まった支払いを除く)の切り替え(デザインの月末の見込み)。 */
const SCOPES = [
  { value: 'all', label: '全体' },
  { value: 'changeable', label: '変えられる支出だけ' },
] as const;

export function GoalChart({
  genreName,
  lines: allLines,
  monthStart,
  monthEnd,
  today,
  budgetYen: allBudget,
  goalFrom,
  goalTo,
  remaining: allRemaining,
  changeable,
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
  /**
   * 「変えられる支出だけ」(設計書 v3 3.4)。決まった支出のジャンルを除いた行・予算・予測。
   * まとまった支払いで「理想より多い」に見えないようにする。
   */
  changeable?: { lines: CategoryLine[]; budgetYen: number; remaining: RemainingForecast } | null;
}) {
  const [onlyChangeable, setOnlyChangeable] = useState(false);
  const view =
    onlyChangeable && changeable
      ? changeable
      : { lines: allLines, budgetYen: allBudget, remaining: allRemaining };
  return (
    <div className="space-y-2">
      {changeable ? (
        <Segmented
          value={onlyChangeable ? 'changeable' : 'all'}
          options={SCOPES}
          onChange={(v) => setOnlyChangeable(v === 'changeable')}
          label="グラフの範囲"
          className="flex w-full [&>button]:flex-1"
        />
      ) : null}
      <GoalChartView
        genreName={onlyChangeable && changeable ? '変えられる支出' : genreName}
        lines={view.lines}
        monthStart={monthStart}
        monthEnd={monthEnd}
        today={today}
        budgetYen={view.budgetYen}
        goalFrom={goalFrom}
        goalTo={goalTo}
        remaining={view.remaining}
      />
    </div>
  );
}

function GoalChartView({
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
      budgetYen={budgetYen}
    />
  );
}
