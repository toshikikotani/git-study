'use client';

import { formatEstimate } from '@/domain/forecast/format';
import { useSpendingMonth } from '../spending/spending-month-provider';

/**
 * 分析の先頭(デザイン仕様書の「分析」、ADR-090):その月の支出・収入・貯蓄率の3枚。
 * 貯蓄率は (収入 − 支出) ÷ 収入。収入が無い月は出さない。
 */
export function AnalysisSummary() {
  const { totals, loading, isCurrentMonth } = useSpendingMonth();
  const waiting = loading && !isCurrentMonth;
  const rate =
    totals.incomeYen > 0 ? (totals.incomeYen - totals.spentYen) / totals.incomeYen : null;
  const man = (yen: number) => formatEstimate(yen, { approx: false });
  const cards = [
    {
      key: 'spent',
      label: '支出',
      value: waiting ? '—' : man(totals.spentYen),
      color: 'var(--ink)',
    },
    {
      key: 'income',
      label: '収入',
      value: waiting ? '—' : man(totals.incomeYen),
      color: 'var(--ink)',
    },
    {
      key: 'rate',
      label: '貯蓄率',
      value: waiting || rate === null ? '—' : `${Math.round(rate * 100)}%`,
      color: rate !== null && rate < 0 ? 'var(--state-caution)' : 'var(--income)',
    },
  ];
  return (
    <section aria-label="この月の合計" className="tabular grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <div
          key={c.key}
          className="flex flex-col gap-1 rounded-2xl px-3 py-4"
          style={{ background: 'var(--surface)' }}
        >
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {c.label}
          </span>
          <span className="text-[18px] font-bold" style={{ color: c.color }}>
            {c.value}
          </span>
        </div>
      ))}
    </section>
  );
}
