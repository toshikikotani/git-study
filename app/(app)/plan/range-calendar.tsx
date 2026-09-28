'use client';

import { useState } from 'react';

import { nextPlanRange } from '@/domain/spending-plan';
import {
  addDays,
  addMonths,
  daysBetween,
  formatMonthJa,
  nthDayOfMonth,
  splitDateOnly,
  weekdayOf,
  type DateOnly,
} from '@/lib/date';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * 期間を選ぶカレンダー(本人発案「カレンダーの範囲を選択して」)。
 * タップでの範囲の変わり方は domain/spending-plan.ts の nextPlanRange を参照。
 */
export function RangeCalendar({
  start,
  end,
  today,
  onChange,
}: {
  start: DateOnly | null;
  end: DateOnly | null;
  today: DateOnly;
  onChange: (range: { start: DateOnly | null; end: DateOnly | null }) => void;
}) {
  const [monthStart, setMonthStart] = useState(() => nthDayOfMonth(start ?? today, 1));

  const cells: (DateOnly | null)[] = [
    ...Array.from({ length: weekdayOf(monthStart) }, () => null),
    ...Array.from({ length: daysBetween(monthStart, addMonths(monthStart, 1)) }, (_, i) =>
      addDays(monthStart, i),
    ),
  ];

  const select = (date: DateOnly) => onChange(nextPlanRange({ start, end }, date));

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="前の月"
          onClick={() => setMonthStart(addMonths(monthStart, -1))}
          className="size-9 rounded-full text-base"
          style={{ color: 'var(--ink-secondary)' }}
        >
          ‹
        </button>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatMonthJa(monthStart.slice(0, 7))}
        </p>
        <button
          type="button"
          aria-label="次の月"
          onClick={() => setMonthStart(addMonths(monthStart, 1))}
          className="size-9 rounded-full text-base"
          style={{ color: 'var(--ink-secondary)' }}
        >
          ›
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="text-[10px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (date === null) return <span key={`blank-${i}`} />;
          const isEdge = date === start || date === end;
          const inRange = start !== null && end !== null && date > start && date < end;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={isEdge}
              onClick={() => select(date)}
              className="mx-auto flex h-9 w-full items-center justify-center text-xs"
              style={{
                background: inRange || isEdge ? 'var(--accent-track)' : 'transparent',
                borderRadius:
                  date === start && end !== null
                    ? '999px 0 0 999px'
                    : date === end
                      ? '0 999px 999px 0'
                      : isEdge
                        ? '999px'
                        : 0,
              }}
            >
              <span
                className="flex size-8 items-center justify-center rounded-full font-medium"
                style={{
                  background: isEdge ? 'var(--accent)' : 'transparent',
                  color: isEdge ? '#fff' : date === today ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                {splitDateOnly(date)[2]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
