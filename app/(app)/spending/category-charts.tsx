'use client';

import { useMemo, useState } from 'react';

import { CategoryChart, type ChartMode } from './category/[genreKey]/category-chart';
import { buildCategoryLines, type CategoryTx } from '@/features/category/model';
import { buildCumulative, categoryAllowanceYen, idealDeltaLabel } from '@/features/category/pace';
import { buildSeries, type ChartUnit } from '@/features/category/series';
import type { DateOnly } from '@/lib/date';

export function CategoryCharts({
  transactions,
  genres,
  monthStart,
  monthEnd,
  today,
  goalFrom,
  goalTo,
}: {
  transactions: CategoryTx[];
  genres: readonly { id: string; name: string; budgetYen: number | null }[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  goalFrom: DateOnly | null;
  goalTo: DateOnly | null;
}) {
  const active = genres.filter(
    (genre) => genre.budgetYen !== null || transactions.some((tx) => tx.genreId === genre.id),
  );
  if (active.length === 0) return null;
  return (
    <section aria-label="カテゴリのグラフ" className="space-y-3">
      {active.map((genre) => (
        <CategoryGraph
          key={genre.id}
          genreId={genre.id}
          genreName={genre.name}
          budgetYen={genre.budgetYen}
          transactions={transactions}
          monthStart={monthStart}
          monthEnd={monthEnd}
          today={today}
          goalFrom={goalFrom}
          goalTo={goalTo}
        />
      ))}
    </section>
  );
}

function CategoryGraph({
  genreId,
  genreName,
  budgetYen,
  transactions,
  monthStart,
  monthEnd,
  today,
  goalFrom,
  goalTo,
}: {
  genreId: string;
  genreName: string;
  budgetYen: number | null;
  transactions: CategoryTx[];
  monthStart: DateOnly;
  monthEnd: DateOnly;
  today: DateOnly;
  goalFrom: DateOnly | null;
  goalTo: DateOnly | null;
}) {
  const [mode, setMode] = useState<ChartMode>('cumulative');
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [showPrevious, setShowPrevious] = useState(false);
  const lines = useMemo(
    () => buildCategoryLines(transactions, genreId, { from: monthStart, to: monthEnd }, today),
    [transactions, genreId, monthStart, monthEnd, today],
  );
  const series = useMemo(
    () =>
      buildSeries({
        lines,
        unit,
        monthStart,
        monthEnd,
        today,
        dailyAllowanceYen:
          budgetYen !== null && goalFrom && goalTo
            ? categoryAllowanceYen({
                budgetYen,
                scheduledYen: 0,
                lines,
                goalRange: { from: goalFrom, to: goalTo },
                today,
              })
            : null,
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
        goal:
          budgetYen !== null && goalFrom && goalTo
            ? { range: { from: goalFrom, to: goalTo }, budgetYen }
            : null,
      }),
    [lines, monthStart, monthEnd, today, series.recordStart, budgetYen, goalFrom, goalTo],
  );
  if (lines.length === 0 && budgetYen === null) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm" style={{ color: 'var(--ink)' }}>
        {genreName}
        {cumulative.deltaYen !== null ? `、${idealDeltaLabel(cumulative.deltaYen)}` : ''}
      </p>
      <CategoryChart
        series={series}
        cumulative={cumulative}
        mode={mode}
        onMode={setMode}
        genreName={genreName}
        monthLabel={`${Number(monthStart.slice(5, 7))}月`}
        showPrevious={showPrevious}
        onShowPrevious={setShowPrevious}
        onUnit={setUnit}
        onPick={() => undefined}
        selectedIndex={null}
        budgetYen={budgetYen}
      />
    </div>
  );
}
