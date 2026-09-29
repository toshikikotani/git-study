'use client';

import type { ReactNode } from 'react';

import { formatYen } from '@/domain/money';
import { splitDateOnly } from '@/lib/date';
import type { MonthlyPace } from '@/features/spending/ledger-types';
import { useSpendingMonth } from './spending-month-provider';

/**
 * 家計簿の「使った額」(今月使った額・収入・差額)。カレンダーで別の月へ移ると、
 * その月の合計に切り替わる(本人発案「今月使った額がうまく追従してない」)。
 *
 * 先月同日比(pace)は「今月の途中経過を先月の同じ日と比べる」ものなので、今月
 * のときだけ出す。別の月は、その月の合計だけを見せる。
 */
export function MonthLinkedSummaryCard({ pace }: { pace: MonthlyPace }) {
  const { totals, isCurrentMonth, visibleMonth, loading, error } = useSpendingMonth();
  const [year, month] = splitDateOnly(visibleMonth);
  const netYen = totals.incomeYen - totals.spentYen;
  const isLess = pace.differenceYen < 0;
  const hasDifference = pace.differenceYen !== 0;
  // 別の月を取りに行っているあいだは、0円ではなく読み込み中と分かるようにする。
  const waiting = !isCurrentMonth && (loading || error !== null);

  return (
    <div
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        {isCurrentMonth ? '今月使った額' : `${year}年${month}月に使った額`}
      </p>
      <p
        className="mt-1 text-4xl leading-none font-semibold tracking-tight"
        style={{ color: waiting ? 'var(--ink-muted)' : 'var(--ink)' }}
      >
        {waiting ? '—' : formatYen(totals.spentYen, { sign: 'never' })}
      </p>
      {waiting ? (
        <p
          className="mt-2 text-xs"
          style={{ color: error !== null ? 'var(--over)' : 'var(--ink-muted)' }}
        >
          {error ?? 'この月の合計を読み込んでいます…'}
        </p>
      ) : null}

      <dl
        className="mt-4 grid grid-cols-2 gap-3 border-t pt-4"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div>
          <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            収入
          </dt>
          <dd className="tabular text-sm font-semibold" style={{ color: 'var(--income)' }}>
            {waiting ? '—' : formatYen(totals.incomeYen, { sign: 'never' })}
          </dd>
        </div>
        <div>
          <dt className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            差額
          </dt>
          <dd
            className="tabular text-sm font-semibold"
            style={{
              color: waiting ? 'var(--ink-muted)' : netYen >= 0 ? 'var(--income)' : 'var(--over)',
            }}
          >
            {waiting ? '—' : formatYen(netYen)}
          </dd>
        </div>
      </dl>

      {isCurrentMonth ? (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          先月の{pace.dayOfMonth}日時点は {formatYen(pace.lastMonthSameDayYen, { sign: 'never' })}。
          {hasDifference ? (
            <>
              {' '}
              今月は{' '}
              <span
                className="tabular font-semibold whitespace-nowrap"
                style={{ color: isLess ? 'var(--income)' : 'var(--over)' }}
              >
                {formatYen(pace.differenceYen, { sign: 'never' })} {isLess ? '少ない' : '多い'}
              </span>
              。
            </>
          ) : (
            ' 今月はちょうど同じです。'
          )}
        </p>
      ) : null}
    </div>
  );
}

/** 今月にしか意味が無いカード(月末までの着地見込みなど)を、別の月では隠す。 */
export function CurrentMonthOnly({ children }: { children: ReactNode }) {
  const { isCurrentMonth } = useSpendingMonth();
  return isCurrentMonth ? <>{children}</> : null;
}
