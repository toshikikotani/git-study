'use client';

import { useId, useState } from 'react';

import type { CalendarView } from '@/lib/calendar-view';
import { CalendarHeatmap } from './calendar-heatmap';
import { FilterSheet } from './filter-sheet';
import { useSpendingMonth } from './spending-month-provider';

/** 検索・絞り込み・カレンダーを1行にまとめる。カレンダーは必要なときだけ開く。 */
export function LedgerSearchControls({
  initialCalendarView = 'week',
}: {
  initialCalendarView?: CalendarView;
} = {}) {
  const { filter, setFilter } = useSpendingMonth();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarId = useId();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div
          className="flex min-w-0 flex-1 items-center rounded-xl"
          style={{ background: 'var(--field)', color: 'var(--ink-muted)' }}
        >
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 pl-3">
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
            <input
              type="search"
              value={filter.search ?? ''}
              onChange={(event) => setFilter({ search: event.target.value })}
              placeholder="店名・品目・メモ"
              aria-label="明細を検索"
              className="min-w-0 flex-1 bg-transparent text-[17px] outline-none"
              style={{ color: 'var(--ink)' }}
            />
          </label>
          <FilterSheet goalRange={null} compact />
        </div>
        <button
          type="button"
          aria-label="カレンダー"
          aria-expanded={calendarOpen}
          aria-controls={calendarOpen ? calendarId : undefined}
          onClick={() => setCalendarOpen((open) => !open)}
          className="flex size-11 min-h-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: calendarOpen ? 'var(--accent)' : 'var(--field)',
            color: calendarOpen ? 'var(--on-accent)' : 'var(--ink-secondary)',
          }}
        >
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="5" width="16" height="16" rx="3" />
            <path d="M8 3v4M16 3v4M4 11h16" />
          </svg>
        </button>
      </div>
      {calendarOpen ? (
        <div id={calendarId}>
          <CalendarHeatmap initialView={initialCalendarView} />
        </div>
      ) : null}
    </div>
  );
}
