'use client';

import { addMonths, nthDayOfMonth, splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

/** カレンダーで移動できる範囲(今日から前後何か月まで。actions.ts と揃える)。 */
const MONTHS_BACK = 120;
const MONTHS_FORWARD = 24;

function Chevron({ d }: { d: string }) {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * 見出しと月の切り替え(デザイン仕様書の「明細」「分析」、ADR-090):左に大きな見出し、右に
 * ‹ 10月 › の白い丸い切り替え。合計・カレンダー・明細・カテゴリがすべてこの月に連動する。
 */
export function PeriodSwitcher({ title = '明細' }: { title?: string }) {
  const { visibleMonth, currentMonthStart, today, isCurrentMonth, goToMonth } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  const [currentYear] = splitDateOnly(currentMonthStart);
  const earliest = addMonths(nthDayOfMonth(today, 1), -MONTHS_BACK);
  const latest = addMonths(nthDayOfMonth(today, 1), MONTHS_FORWARD);
  const prev = addMonths(visibleMonth, -1);
  const next = addMonths(visibleMonth, 1);
  const yearPrefix = year !== currentYear ? `${year}年` : '';

  return (
    <header className="flex items-end justify-between gap-2 px-1 pt-2">
      <div className="flex flex-col">
        <h1 className="text-[34px] leading-tight font-bold" style={{ color: 'var(--ink)' }}>
          {title}
        </h1>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={() => goToMonth(currentMonthStart)}
            className="min-h-11 self-start text-[13px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            今月へ戻る
          </button>
        ) : null}
      </div>
      <div
        role="group"
        aria-label="表示する月"
        className="flex h-11 items-center rounded-full"
        style={{ background: 'var(--surface)' }}
      >
        <button
          type="button"
          aria-label="前の月"
          className="flex size-11 min-h-11 items-center justify-center disabled:opacity-30"
          style={{ color: 'var(--ink-secondary)' }}
          disabled={prev < earliest}
          onClick={() => goToMonth(prev)}
        >
          <Chevron d="M15 5l-7 7 7 7" />
        </button>
        <span
          aria-live="polite"
          className="tabular min-w-11 text-center text-[15px] font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          {yearPrefix}
          {month}月
        </span>
        <button
          type="button"
          aria-label="次の月"
          className="flex size-11 min-h-11 items-center justify-center disabled:opacity-30"
          style={{ color: 'var(--ink-secondary)' }}
          disabled={next > latest}
          onClick={() => goToMonth(next)}
        >
          <Chevron d="M9 5l7 7-7 7" />
        </button>
      </div>
    </header>
  );
}
