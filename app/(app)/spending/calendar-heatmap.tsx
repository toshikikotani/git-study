'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { formatYen } from '@/domain/money';
import { heatLevel, monthGrid, weekOf } from '@/features/spending/heatmap';
import type { CalendarView } from '@/lib/calendar-view';
import { formatDateJa, splitDateOnly, weekdayOf } from '@/lib/date';
import { useOpenRecord } from '../record-sheet';
import { saveCalendarView, useCalendarView } from './calendar-prefs';
import { useSpendingMonth } from './spending-month-provider';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
/** 面の濃さ。文字色と背景色の混合なので、明暗どちらのテーマでも段階が分かる。 */
const HEAT_MIX = [0, 18, 40, 68, 100];

/** 2026-10-11 〜 2026-10-17 → 「10月11日〜17日」 */
function weekLabel(week: readonly string[]): string {
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const [, m1, d1] = splitDateOnly(first);
  const [, m2, d2] = splitDateOnly(last);
  return m1 === m2 ? `${m1}月${d1}日〜${d2}日` : `${m1}月${d1}日〜${m2}月${d2}日`;
}

/**
 * カレンダー(デザイン仕様書の「明細」、ADR-090)。既定は今日のある週、「月で見る」で月全体。
 * 選んだ表示(週 / 月)は覚えておき、次に開いたときも同じにする(ADR-093)。
 * 日付の面が濃いほど多く使った日。今日は輪郭と「今日」で示し、予定がある日は輪の点。
 * 日付をタップすると明細がその日に絞り込まれる(もう一度で解除)。
 */
export function CalendarHeatmap({
  initialView = 'week',
}: {
  /** サーバーで読んだ、前回の表示(cookie)。 */
  initialView?: CalendarView;
} = {}) {
  const { visibleMonth, totals, today, filter, setFilter, isCurrentMonth } = useSpendingMonth();
  const openRecord = useOpenRecord();
  const expanded = useCalendarView(initialView) === 'month';

  const monthKey = visibleMonth.slice(0, 7);
  const weekAnchor = isCurrentMonth && today.startsWith(monthKey) ? today : visibleMonth;
  const weeks = expanded ? monthGrid(monthKey) : [weekOf(weekAnchor)];
  const [, visibleMonthNumber] = splitDateOnly(visibleMonth);

  const max = useMemo(() => Math.max(...Object.values(totals.daySpend), 0), [totals.daySpend]);

  return (
    <section
      aria-label="カレンダー"
      className="rounded-2xl px-3 pt-3 pb-3"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          {expanded ? `${visibleMonthNumber}月` : weekLabel(weeks[0]!)}
        </h2>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => saveCalendarView(expanded ? 'week' : 'month')}
          className="min-h-11 rounded-full px-3 text-[13px] font-semibold"
          style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
        >
          {expanded ? '週で見る' : '月で見る'}
        </button>
      </div>

      <div role="grid" aria-label="日付ごとの支出">
        <div className="grid grid-cols-7 gap-1 text-center" role="row">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              role="columnheader"
              className="text-[11px]"
              style={{ color: 'var(--ink-muted)' }}
            >
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className="mt-1 grid grid-cols-7 gap-1">
            {week.map((date) => {
              const inMonth = date.startsWith(monthKey);
              const spent = totals.daySpend[date] ?? 0;
              const scheduled = totals.scheduledDaySpend[date] ?? 0;
              const level = inMonth ? heatLevel(spent, max) : 0;
              const selected = filter.date === date;
              const isToday = date === today;
              const future = date > today;
              const [, , d] = splitDateOnly(date);
              const label = `${formatDateJa(date)}(${WEEKDAYS[weekdayOf(date)]})、${
                spent > 0 ? `使った額 ${formatYen(spent, { sign: 'never' })}` : '支出なし'
              }${scheduled > 0 ? `、予定 ${formatYen(scheduled, { sign: 'never' })}` : ''}${isToday ? '、今日' : ''}`;

              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  aria-label={label}
                  aria-selected={selected}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => setFilter({ date: selected ? null : date })}
                  className="flex h-13 min-h-11 flex-col items-center justify-center gap-1 rounded-xl"
                  style={{
                    background:
                      level > 0
                        ? `color-mix(in srgb, var(--ink) ${HEAT_MIX[level]}%, var(--plane))`
                        : future
                          ? 'var(--surface)'
                          : 'var(--plane)',
                    color: level >= 3 ? 'var(--plane)' : future ? 'var(--ink-muted)' : 'var(--ink)',
                    boxShadow: isToday
                      ? 'inset 0 0 0 1px var(--accent)'
                      : future
                        ? 'inset 0 0 0 1px var(--hairline)'
                        : 'none',
                    outline: selected ? '2px solid var(--accent)' : 'none',
                    outlineOffset: '1px',
                    opacity: inMonth ? 1 : 0.4,
                  }}
                >
                  <span className={`tabular text-[16px] ${isToday ? 'font-bold' : 'font-medium'}`}>
                    {d}
                  </span>
                  {isToday ? (
                    <span className="text-[11px] leading-none font-semibold">今日</span>
                  ) : scheduled > 0 && future ? (
                    <span
                      aria-hidden
                      data-scheduled-mark
                      className="size-2 rounded-full"
                      style={{ border: '1.5px solid var(--ideal)' }}
                    />
                  ) : (
                    <span aria-hidden className="size-2" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center justify-end gap-4 px-1 pt-3 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        {filter.date !== null ? (
          // 手で記録するのは「記録する」のシートだけ(ADR-096)。その日を日付にして開く。
          openRecord ? (
            <button
              type="button"
              onClick={() => filter.date && openRecord({ date: filter.date })}
              className="mr-auto inline-flex min-h-11 items-center text-[13px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {formatDateJa(filter.date)}に手で記録
            </button>
          ) : (
            <Link
              href={`/spending?record=1&date=${filter.date}`}
              prefetch={false}
              className="mr-auto inline-flex min-h-11 items-center text-[13px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {formatDateJa(filter.date)}に手で記録
            </Link>
          )
        ) : null}
        <span className="flex items-center gap-1">
          <span aria-hidden className="flex gap-1">
            {HEAT_MIX.slice(1).map((mix) => (
              <span
                key={mix}
                className="size-2 rounded-sm"
                style={{
                  background: `color-mix(in srgb, var(--ink) ${mix}%, var(--plane))`,
                }}
              />
            ))}
          </span>
          色が濃いほど多い
        </span>
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ border: '1.5px solid var(--ideal)' }}
          />
          予定あり
        </span>
      </div>
    </section>
  );
}
