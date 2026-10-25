'use client';

import { formatYen } from '@/domain/money';
import { useSpendingMonth } from '../spending/spending-month-provider';

/**
 * 分析の先頭(デザイン仕様書の「分析」、ADR-090):その月の支出・収入・貯蓄率の3枚。
 * 貯蓄率は (収入 − 支出) ÷ 収入。収入が無い月は出さない。
 * 使った額・入った額は事実なので、下の円グラフと同じく円まで出す(「13.3万円」と「132,925円」が
 * 同じ画面に並んでいた、ADR-131)。万に丸めるのは見込みだけ。
 */
export function AnalysisSummary() {
  const { totals, loading, isCurrentMonth } = useSpendingMonth();
  const waiting = loading && !isCurrentMonth;
  const rate =
    totals.incomeYen > 0 ? (totals.incomeYen - totals.spentYen) / totals.incomeYen : null;
  const yen = (amount: number) => formatYen(amount, { sign: 'never' });
  const cards = [
    {
      key: 'spent',
      label: '支出',
      value: waiting ? '—' : yen(totals.spentYen),
      color: 'var(--ink)',
    },
    {
      key: 'income',
      label: '収入',
      value: waiting ? '—' : yen(totals.incomeYen),
      color: 'var(--ink)',
    },
    {
      key: 'rate',
      label: '貯蓄率',
      value: waiting || rate === null ? '—' : `${Math.round(rate * 100)}%`,
      color: rate !== null && rate < 0 ? 'var(--over)' : 'var(--income)',
    },
  ];
  return (
    <section aria-label="この月の合計" className="hm-panel hm-metric tabular">
      {cards.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col gap-2">
          <span className="hm-metric__label text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {c.label}
          </span>
          <span
            className={`${c.value.length > 9 ? 'text-[15px]' : 'text-[17px]'} font-bold break-words`}
            style={{ color: c.color }}
          >
            {c.value}
          </span>
        </div>
      ))}
    </section>
  );
}
