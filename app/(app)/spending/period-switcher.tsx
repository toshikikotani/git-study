'use client';

import { MdChevronLeft, MdChevronRight } from 'react-icons/md';

import { addMonths, nthDayOfMonth, splitDateOnly } from '@/lib/date';
import { useSpendingMonth } from './spending-month-provider';

/** カレンダーで移動できる範囲(今日から前後何か月まで。actions.ts と揃える)。 */
const MONTHS_BACK = 120;
const MONTHS_FORWARD = 24;

/**
 * 家計簿の見出しと期間の切り替え(デザインの「家計簿」、ADR-085):左に期間と「家計簿」、
 * 右に前の月・次の月。サマリー・内訳・カレンダー・明細がすべてこの月に連動する。
 */
export function PeriodSwitcher() {
  const { visibleMonth, currentMonthStart, today, isCurrentMonth, goToMonth } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  const [currentYear] = splitDateOnly(currentMonthStart);
  const [, , todayDay] = splitDateOnly(today);
  const earliest = addMonths(nthDayOfMonth(today, 1), -MONTHS_BACK);
  const latest = addMonths(nthDayOfMonth(today, 1), MONTHS_FORWARD);
  const prev = addMonths(visibleMonth, -1);
  const next = addMonths(visibleMonth, 1);
  const yearPrefix = year !== currentYear ? `${year}年` : '';

  const button =
    'flex size-11 min-h-11 items-center justify-center rounded-full disabled:opacity-30';
  const buttonStyle = {
    background: 'var(--surface)',
    color: 'var(--ink)',
    boxShadow: 'var(--card-shadow)',
  } as const;

  return (
    <header className="flex items-end justify-between gap-2 px-1 pb-1">
      <div>
        <p
          className="text-xs font-medium"
          style={{ color: 'var(--ink-secondary)' }}
          aria-live="polite"
        >
          {isCurrentMonth ? `${month}月1日〜${todayDay}日` : `${yearPrefix}${month}月`}
        </p>
        <h1 className="text-xl font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
          家計簿
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
      <div className="flex gap-2" role="group" aria-label="表示する月">
        <button
          type="button"
          aria-label="前の月"
          className={`min-h-11 ${button}`}
          style={buttonStyle}
          disabled={prev < earliest}
          onClick={() => goToMonth(prev)}
        >
          <MdChevronLeft aria-hidden size={22} />
        </button>
        <button
          type="button"
          aria-label="次の月"
          className={`min-h-11 ${button}`}
          style={buttonStyle}
          disabled={next > latest}
          onClick={() => goToMonth(next)}
        >
          <MdChevronRight aria-hidden size={22} />
        </button>
      </div>
    </header>
  );
}
