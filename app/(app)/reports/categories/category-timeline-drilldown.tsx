'use client';

import { useMemo, useState } from 'react';

import { formatYen } from '@/domain/money';
import {
  distinctYearsWithSpend,
  summarizeSpendByPeriod,
  type SpendingTransaction,
} from '@/domain/spending';
import type { CategoryTimelineTransaction } from '@/features/categories/category-timeline-store';
import { addDays, addMonths, daysBetween, type DateOnly } from '@/lib/date';

type Level = 'year' | 'month' | 'day';

/**
 * カテゴリ別ページの下段:年→月→日のドリルダウン(本人発案:「年選択
 * しといてタップしたら月 月から日……これ自由に切り替えるように」)。
 *
 * 時間(何時に使ったか)は transactions.occurred_on が date 型で時刻を
 * 持たないため対象外(本人に確認済み)。深掘りできるのは年→月→日の3段階。
 *
 * ── なぜページ遷移ではなく1画面のクライアント状態か ───────────────
 * 「自由に切り替える」には、途中の階層へいつでも戻れる必要がある。
 * パンくず(全期間 > ◯年 > ◯月)のどこを押しても即座にその階層へ戻れる
 * ようにするには、サーバー往復を挟まないクライアント側の状態切り替えが
 * 最短。データは page.tsx が1回だけ全期間分を渡し(新しいクエリを増やさない)、
 * 集計は domain/spending.ts の summarizeSpendByPeriod() をその場で呼ぶ。
 */
export function CategoryTimelineDrilldown({
  transactions,
}: {
  transactions: readonly CategoryTimelineTransaction[];
}) {
  const [level, setLevel] = useState<Level>('year');
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<DateOnly | null>(null);

  const spendingTransactions: SpendingTransaction[] = useMemo(
    () =>
      transactions.map((t) => ({
        categoryId: null,
        amountYen: t.amountYen,
        isTransfer: false,
        reviewStatus: 'auto_ok' as const,
        occurredOn: t.occurredOn,
      })),
    [transactions],
  );

  const years = useMemo(() => distinctYearsWithSpend(spendingTransactions), [spendingTransactions]);

  if (years.length === 0) {
    return (
      <div
        className="rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          年ごとの内訳
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          このカテゴリの支出記録がまだありません。
        </p>
      </div>
    );
  }

  function openYear(year: string) {
    setSelectedYear(year);
    setSelectedMonth(null);
    setExpandedDay(null);
    setLevel('month');
  }

  function openMonth(monthKey: string) {
    setSelectedMonth(monthKey);
    setExpandedDay(null);
    setLevel('day');
  }

  function backToYears() {
    setSelectedYear(null);
    setSelectedMonth(null);
    setExpandedDay(null);
    setLevel('year');
  }

  function backToMonths() {
    setSelectedMonth(null);
    setExpandedDay(null);
    setLevel('month');
  }

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <Breadcrumb
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onAll={backToYears}
        onYear={backToMonths}
      />

      {level === 'year' ? (
        <YearLevel years={years} transactions={spendingTransactions} onSelect={openYear} />
      ) : null}

      {level === 'month' && selectedYear ? (
        <MonthLevel year={selectedYear} transactions={spendingTransactions} onSelect={openMonth} />
      ) : null}

      {level === 'day' && selectedMonth ? (
        <DayLevel
          monthKey={selectedMonth}
          transactions={spendingTransactions}
          rawTransactions={transactions}
          expandedDay={expandedDay}
          onToggleDay={(date) => setExpandedDay((current) => (current === date ? null : date))}
        />
      ) : null}
    </div>
  );
}

function Breadcrumb({
  selectedYear,
  selectedMonth,
  onAll,
  onYear,
}: {
  selectedYear: string | null;
  selectedMonth: string | null;
  onAll: () => void;
  onYear: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 text-xs"
      style={{ color: 'var(--ink-muted)' }}
    >
      <CrumbButton active={selectedYear === null} onClick={onAll}>
        年ごとの内訳
      </CrumbButton>
      {selectedYear ? (
        <>
          <span aria-hidden>›</span>
          <CrumbButton active={selectedMonth === null} onClick={onYear}>
            {selectedYear}年
          </CrumbButton>
        </>
      ) : null}
      {selectedMonth ? (
        <>
          <span aria-hidden>›</span>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>
            {Number(selectedMonth.slice(5, 7))}月
          </span>
        </>
      ) : null}
    </div>
  );
}

function CrumbButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-semibold"
      style={{ color: active ? 'var(--ink)' : 'var(--accent)' }}
    >
      {children}
    </button>
  );
}

function YearLevel({
  years,
  transactions,
  onSelect,
}: {
  years: readonly string[];
  transactions: readonly SpendingTransaction[];
  onSelect: (year: string) => void;
}) {
  const rows = summarizeSpendByPeriod(transactions, years, 4);
  const maxYen = Math.max(...rows.map((r) => r.spentYen), 1);

  return (
    <ol className="mt-4 space-y-2.5">
      {rows.map((row) => (
        <PeriodBar
          key={row.period}
          label={`${row.period}年`}
          spentYen={row.spentYen}
          maxYen={maxYen}
          onClick={() => onSelect(row.period)}
        />
      ))}
    </ol>
  );
}

function MonthLevel({
  year,
  transactions,
  onSelect,
}: {
  year: string;
  transactions: readonly SpendingTransaction[];
  onSelect: (monthKey: string) => void;
}) {
  const monthKeys = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
  );
  const rows = summarizeSpendByPeriod(transactions, monthKeys, 7);
  const maxYen = Math.max(...rows.map((r) => r.spentYen), 1);

  return (
    <ol className="mt-4 space-y-2.5">
      {rows.map((row) => (
        <PeriodBar
          key={row.period}
          label={`${Number(row.period.slice(5, 7))}月`}
          spentYen={row.spentYen}
          maxYen={maxYen}
          onClick={() => onSelect(row.period)}
        />
      ))}
    </ol>
  );
}

function DayLevel({
  monthKey,
  transactions,
  rawTransactions,
  expandedDay,
  onToggleDay,
}: {
  monthKey: string;
  transactions: readonly SpendingTransaction[];
  rawTransactions: readonly CategoryTimelineTransaction[];
  expandedDay: DateOnly | null;
  onToggleDay: (date: DateOnly) => void;
}) {
  const monthStart: DateOnly = `${monthKey}-01`;
  const daysInMonth = daysBetween(monthStart, addMonths(monthStart, 1));
  const dateKeys = Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i));
  const rows = summarizeSpendByPeriod(transactions, dateKeys, 10);
  const maxYen = Math.max(...rows.map((r) => r.spentYen), 1);

  return (
    <ol className="mt-4 space-y-2.5">
      {rows.map((row) => {
        const date = row.period;
        const dayTransactions = rawTransactions.filter((t) => t.occurredOn === date);
        const isExpanded = expandedDay === date;
        return (
          <li key={date}>
            <PeriodBar
              label={`${Number(date.slice(8, 10))}日`}
              spentYen={row.spentYen}
              maxYen={maxYen}
              onClick={() => onToggleDay(date)}
            />
            {isExpanded ? (
              <ul
                className="mt-1.5 space-y-1 border-t pt-1.5"
                style={{ borderColor: 'var(--hairline)' }}
              >
                {dayTransactions.length === 0 ? (
                  <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    この日の明細はありません
                  </p>
                ) : (
                  dayTransactions.map((t, index) => (
                    <li
                      key={`${t.id}-${index}`}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate" style={{ color: 'var(--ink-secondary)' }}>
                        {t.label}
                      </span>
                      <span className="tabular shrink-0" style={{ color: 'var(--ink)' }}>
                        {formatYen(t.amountYen, { sign: 'never' })}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function PeriodBar({
  label,
  spentYen,
  maxYen,
  onClick,
}: {
  label: string;
  spentYen: number;
  maxYen: number;
  onClick: () => void;
}) {
  const percent = Math.round((spentYen / maxYen) * 100);
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium" style={{ color: 'var(--ink)' }}>
          {label}
        </span>
        <span className="tabular font-medium" style={{ color: 'var(--ink)' }}>
          {formatYen(spentYen, { sign: 'never' })}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full"
        style={{ background: 'var(--over-track)' }}
        title={`${label}: ${formatYen(spentYen, { sign: 'never' })}`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, background: 'var(--over)' }}
        />
      </div>
    </button>
  );
}
