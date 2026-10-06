'use client';

import { MdChevronLeft, MdChevronRight } from 'react-icons/md';

import { addMonths, nthDayOfMonth, splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

/** カレンダーで移動できる範囲(今日から前後何か月まで。actions.ts と揃える)。 */
const MONTHS_BACK = 120;
const MONTHS_FORWARD = 24;

/** 期間の切り替え(‹ 9月 ›)。サマリー・内訳・カレンダー・明細がすべてこの月に連動する。 */
export function PeriodSwitcher() {
  const { visibleMonth, currentMonthStart, today, isCurrentMonth, goToMonth } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  const [currentYear] = splitDateOnly(currentMonthStart);
  const earliest = addMonths(nthDayOfMonth(today, 1), -MONTHS_BACK);
  const latest = addMonths(nthDayOfMonth(today, 1), MONTHS_FORWARD);
  const prev = addMonths(visibleMonth, -1);
  const next = addMonths(visibleMonth, 1);

  const button = 'flex size-10 items-center justify-center rounded-full disabled:opacity-30';

  return (
    <div className="flex items-center justify-between" role="group" aria-label="表示する月">
      <button
        type="button"
        aria-label="前の月"
        className={`min-h-11 ${button}`}
        style={{ color: 'var(--ink-secondary)' }}
        disabled={prev < earliest}
        onClick={() => goToMonth(prev)}
      >
        <MdChevronLeft aria-hidden size={26} />
      </button>
      <div className="text-center">
        <h1
          className="text-lg font-semibold tracking-tight"
          style={{ color: 'var(--ink)' }}
          aria-live="polite"
        >
          {year !== currentYear ? `${year}年` : ''}
          {month}月
        </h1>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={() => goToMonth(currentMonthStart)}
            className="min-h-11 text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            今月へ戻る
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="次の月"
        className={`min-h-11 ${button}`}
        style={{ color: 'var(--ink-secondary)' }}
        disabled={next > latest}
        onClick={() => goToMonth(next)}
      >
        <MdChevronRight aria-hidden size={26} />
      </button>
    </div>
  );
}
