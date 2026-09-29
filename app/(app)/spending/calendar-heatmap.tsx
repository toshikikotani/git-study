'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { STATE_COLOR, STATE_ICON, STATE_LABEL } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { bandInWeek } from '@/features/goals/range-calendar-model';
import { dayStatus } from '@/features/goals/view';
import { heatLevel, monthGrid, weekOf } from '@/features/spending/heatmap';
import { addDays, formatDateJa, splitDateOnly, weekdayOf } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

export type CalendarGoal = {
  range: { from: string; to: string };
  /** 1日の目安(目標の合計 ÷ 期間の日数)。 */
  dailyAllowanceYen: number | null;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const HEAT_ALPHA = [0, 0.12, 0.26, 0.42, 0.62];

/**
 * カレンダー(ヒートマップ)。金額の大きさを色の濃さで表す。既定は週表示で、
 * 「月表示」に展開できる。日付をタップすると明細リストがその日に絞り込まれる
 * (もう一度タップで解除)——以前の日別詳細欄は廃止した。
 *
 * 目標期間は、週の行の背後に連続した1本の帯で示す。状態の印は注意(▲)と超過(!)の日だけに付ける
 * (余裕の日は何も付けない)。予定のある日には小さなカレンダーのマークを付ける。今日より先の予定の支出は、金額の代わりに「予」で示す(実績には数えない)。
 * 金額の大きさは背景の塗り(濃さ)だけで表し、日付の数字を主役にする(金額は読み上げのラベルで伝える)。
 */
export function CalendarHeatmap({ goal }: { goal: CalendarGoal | null }) {
  const {
    visibleMonth,
    totals,
    today,
    filter,
    setFilter,
    goToMonth,
    isCurrentMonth,
    currentMonthStart,
  } = useSpendingMonth();
  const [expanded, setExpanded] = useState(false);
  const [anchor, setAnchor] = useState<string>(today);

  const monthKey = visibleMonth.slice(0, 7);
  // 表示中の月に無い anchor は、その月の今日(今月)または1日に寄せる。
  const weekAnchor = anchor.startsWith(monthKey) ? anchor : isCurrentMonth ? today : visibleMonth;
  const weeks = expanded ? monthGrid(monthKey) : [weekOf(weekAnchor)];

  const max = useMemo(() => Math.max(...Object.values(totals.daySpend), 0), [totals.daySpend]);

  const moveWeek = (delta: number) => {
    const next = addDays(weekAnchor, delta * 7);
    setAnchor(next);
    if (!next.startsWith(monthKey)) goToMonth(`${next.slice(0, 7)}-01`);
  };

  return (
    <section
      aria-label="カレンダー"
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          カレンダー
        </h2>
        <div className="flex items-center gap-1">
          {!expanded ? (
            <>
              <button
                type="button"
                aria-label="前の週"
                onClick={() => moveWeek(-1)}
                className="min-h-11 size-8 rounded-full text-sm"
                style={{ color: 'var(--ink-secondary)' }}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="次の週"
                onClick={() => moveWeek(1)}
                className="min-h-11 size-8 rounded-full text-sm"
                style={{ color: 'var(--ink-secondary)' }}
              >
                ›
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="min-h-11 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'var(--plane)', color: 'var(--accent)' }}
          >
            {expanded ? '週表示' : '月表示'}
          </button>
        </div>
      </div>

      <div className="mt-2" role="grid" aria-label="日付ごとの支出">
        <div className="grid grid-cols-7 gap-1 text-center" role="row">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              role="columnheader"
              className="text-xs"
              style={{ color: 'var(--ink-muted)' }}
            >
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const band = goal !== null ? bandInWeek(week, goal.range.from, goal.range.to) : null;
          return (
            <div key={wi} role="row" className="relative mt-1 grid grid-cols-7 gap-1">
              {band !== null ? (
                <span
                  aria-hidden
                  data-goal-band
                  className="absolute inset-y-1"
                  style={{
                    left: `${(band.from / 7) * 100}%`,
                    width: `${((band.to - band.from + 1) / 7) * 100}%`,
                    background: 'var(--accent-track)',
                    borderRadius: `${week[band.from] === goal!.range.from ? 999 : 0}px ${week[band.to] === goal!.range.to ? 999 : 0}px ${week[band.to] === goal!.range.to ? 999 : 0}px ${week[band.from] === goal!.range.from ? 999 : 0}px`,
                  }}
                />
              ) : null}
              {week.map((date) => {
                const inMonth = date.startsWith(monthKey);
                const spent = totals.daySpend[date] ?? 0;
                const scheduled = totals.scheduledDaySpend[date] ?? 0;
                const level = inMonth ? heatLevel(spent, max) : 0;
                const inGoal = goal !== null && date >= goal.range.from && date <= goal.range.to;
                const rawStatus =
                  inGoal && date <= today ? dayStatus(spent, goal!.dailyAllowanceYen) : null;
                // 状態の印は注意・超過の日だけ(余裕は何も付けない)。
                const status = rawStatus === 'caution' || rawStatus === 'over' ? rawStatus : null;
                const selected = filter.date === date;
                const [, m, d] = splitDateOnly(date);
                const label = `${formatDateJa(date)}(${WEEKDAYS[weekdayOf(date)]})、${
                  spent > 0 ? `使った額 ${formatYen(spent, { sign: 'never' })}` : '支出なし'
                }${scheduled > 0 ? `、予定 ${formatYen(scheduled, { sign: 'never' })}` : ''}${
                  status ? `、目安に対して${STATE_LABEL[status]}` : ''
                }${date === today ? '、今日' : ''}`;

                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    aria-selected={selected}
                    onClick={() => setFilter({ date: selected ? null : date })}
                    className="relative z-10 flex h-11 flex-col items-center justify-center rounded-xl"
                    style={{
                      background: `color-mix(in srgb, var(--accent) ${HEAT_ALPHA[level]! * 100}%, transparent)`,
                      outline: selected ? '2px solid var(--accent)' : 'none',
                      outlineOffset: '-2px',
                      opacity: inMonth ? 1 : 0.4,
                    }}
                  >
                    <span
                      className="tabular text-xs"
                      style={{
                        color: 'var(--ink)',
                        fontWeight: date === today ? 700 : 500,
                        textDecoration: date === today ? 'underline' : 'none',
                        textUnderlineOffset: '3px',
                      }}
                    >
                      {expanded && d === 1 ? `${m}/` : ''}
                      {d}
                    </span>

                    {status ? (
                      <span
                        aria-hidden
                        className="absolute top-1 right-1 text-xs leading-none font-bold"
                        style={{ color: STATE_COLOR[status] }}
                      >
                        {STATE_ICON[status]}
                      </span>
                    ) : null}
                    {scheduled > 0 ? (
                      <svg
                        aria-hidden
                        data-scheduled-mark
                        viewBox="0 0 12 12"
                        className="absolute top-1 left-1 size-3"
                        fill="none"
                        stroke="var(--ink-secondary)"
                        strokeWidth="1.2"
                      >
                        <rect x="1.5" y="2.5" width="9" height="8" rx="1.5" />
                        <path d="M1.5 5h9M4 1.5v2M8 1.5v2" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span aria-hidden className="flex items-center gap-1">
          少
          {HEAT_ALPHA.slice(1).map((a) => (
            <span
              key={a}
              className="inline-block size-3 rounded-sm"
              style={{ background: `color-mix(in srgb, var(--accent) ${a * 100}%, transparent)` }}
            />
          ))}
          多
        </span>
        {filter.date !== null ? (
          <Link
            href={`/transactions/new?date=${filter.date}`}
            prefetch={false}
            className="min-h-11 inline-flex items-center font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            {formatDateJa(filter.date)}に手で登録
          </Link>
        ) : null}
      </div>
      {isCurrentMonth ? null : (
        <button
          type="button"
          onClick={() => goToMonth(currentMonthStart)}
          className="min-h-11 mt-1 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          今月へ戻る
        </button>
      )}
    </section>
  );
}
