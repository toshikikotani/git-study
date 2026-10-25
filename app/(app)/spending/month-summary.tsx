'use client';

import { useSpendingMonth } from './spending-month-provider';
import styles from './spending.module.css';

const yen = (v: number) => `${v.toLocaleString('ja-JP')}円`;

/**
 * 月の合計:支出を主な金額に、収入と収支を補助行にまとめる。数字は domain/ledger.ts の
 * 集計(カレンダー・明細と同じ値)。予定は支出に入れない。
 */
export function MonthSummary() {
  const { totals, loading, isCurrentMonth } = useSpendingMonth();
  const diff = totals.incomeYen - totals.spentYen;
  const waiting = loading && !isCurrentMonth;
  return (
    <section
      aria-label="この月の合計"
      className={`hm-panel tabular ${styles.overview}`}
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className={styles.primaryTotal}>
        <span className={styles.metricLabel}>支出</span>
        <span className={styles.primaryValue}>{waiting ? '—' : yen(totals.spentYen)}</span>
      </div>
      <div className={styles.secondaryTotals}>
        <div className={styles.secondaryTotal}>
          <span className={styles.metricLabel}>収入</span>
          <span className={styles.secondaryValue}>{waiting ? '—' : yen(totals.incomeYen)}</span>
        </div>
        <div className={styles.secondaryTotal}>
          <span className={styles.metricLabel}>収支</span>
          <span
            className={styles.secondaryValue}
            style={{ color: diff >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
          >
            {waiting ? '—' : `${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff))}`}
          </span>
        </div>
      </div>
    </section>
  );
}
