'use client';

import { useState } from 'react';

import { nextPlanRange } from '@/domain/spending-plan';
import { bandInWeek, monthsToShow, weekRows } from '@/features/goals/range-calendar-model';
import { formatMonthJa, splitDateOnly, type DateOnly } from '@/lib/date';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * 期間を選ぶカレンダー(本人発案「カレンダーの範囲を選択して」)。
 * タップでの範囲の変わり方は domain/spending-plan.ts の nextPlanRange を参照。
 *
 * 期間が月をまたぐときは、該当する月を縦に並べ、期間全体を週ごとにつながった帯で見せる。
 * すでにある目標の期間(blocked)は選べない(期間の重複は作れない)。
 */
export function RangeCalendar({
  start,
  end,
  today,
  blocked = [],
  onChange,
}: {
  start: DateOnly | null;
  end: DateOnly | null;
  today: DateOnly;
  /** 選べない期間(すでにある目標)。 */
  blocked?: readonly { from: DateOnly; to: DateOnly }[];
  onChange: (range: { start: DateOnly | null; end: DateOnly | null }) => void;
}) {
  const [extra, setExtra] = useState(0);
  const months = monthsToShow(start, end, today, extra);

  const isBlocked = (d: DateOnly) => blocked.some((b) => d >= b.from && d <= b.to);
  const select = (date: DateOnly) => {
    if (isBlocked(date)) return;
    onChange(nextPlanRange({ start, end }, date));
  };

  return (
    <div className="space-y-4">
      {months.map((monthStart) => (
        <div key={monthStart}>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {monthStart.slice(0, 4)}年{formatMonthJa(monthStart.slice(0, 7))}
          </p>
          <div className="mt-1 grid grid-cols-7 text-center">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w} className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {w}
              </span>
            ))}
          </div>
          {weekRows(monthStart).map((week, wi) => {
            const band = bandInWeek(week, start, end);
            return (
              <div key={wi} className="relative grid grid-cols-7">
                {band ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-1"
                    style={{
                      left: `${(band.from / 7) * 100}%`,
                      width: `${((band.to - band.from + 1) / 7) * 100}%`,
                      background: 'var(--accent-track)',
                      borderRadius: `${week[band.from] === start ? 999 : 0}px ${week[band.to] === end ? 999 : 0}px ${week[band.to] === end ? 999 : 0}px ${week[band.from] === start ? 999 : 0}px`,
                    }}
                  />
                ) : null}
                {week.map((date, i) => {
                  if (date === null) return <span key={`b-${wi}-${i}`} />;
                  const edge = date === start || date === end;
                  const off = isBlocked(date);
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={edge}
                      aria-disabled={off}
                      aria-label={`${date}${off ? '(すでに目標があります)' : ''}`}
                      onClick={() => select(date)}
                      className="relative z-10 flex h-11 items-center justify-center text-sm"
                      style={{ opacity: off ? 0.35 : 1 }}
                    >
                      <span
                        className="tabular flex size-9 items-center justify-center rounded-full font-medium"
                        style={{
                          background: edge ? 'var(--accent)' : 'transparent',
                          color: edge
                            ? 'var(--on-accent)'
                            : date === today
                              ? 'var(--accent)'
                              : 'var(--ink)',
                          textDecoration: off ? 'line-through' : 'none',
                        }}
                      >
                        {splitDateOnly(date)[2]}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setExtra((e) => e + 1)}
        className="min-h-11 text-sm font-semibold"
        style={{ color: 'var(--ink-secondary)' }}
      >
        さらに先の月を表示 →
      </button>
    </div>
  );
}
