'use client';

import { useSpendingMonth } from './spending-month-provider';

const yen = (v: number) => `${v.toLocaleString('ja-JP')}円`;

/**
 * 月の合計(デザイン仕様書の「明細」、ADR-090):支出・収入・差額の3列。数字は domain/ledger.ts の
 * 集計(カレンダー・明細と同じ値)。予定は支出に入れない。
 */
export function MonthSummary() {
  const { totals, loading, isCurrentMonth } = useSpendingMonth();
  const diff = totals.incomeYen - totals.spentYen;
  const waiting = loading && !isCurrentMonth;
  const cell = 'flex flex-col items-center';
  return (
    <section
      aria-label="この月の合計"
      className="tabular grid grid-cols-3 rounded-2xl px-1 py-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className={cell}>
        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          支出
        </span>
        <span className="text-[17px] font-bold">{waiting ? '—' : yen(totals.spentYen)}</span>
      </div>
      <div
        className={cell}
        style={{
          borderLeft: '1px solid var(--hairline)',
          borderRight: '1px solid var(--hairline)',
        }}
      >
        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          収入
        </span>
        <span className="text-[17px] font-bold">{waiting ? '—' : yen(totals.incomeYen)}</span>
      </div>
      <div className={cell}>
        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          差額
        </span>
        <span
          className="text-[17px] font-bold"
          style={{ color: diff >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
        >
          {waiting ? '—' : `${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff))}`}
        </span>
      </div>
    </section>
  );
}
