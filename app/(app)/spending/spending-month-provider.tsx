'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { GenreBreakdownRow, MonthTotals } from '@/features/spending/ledger-types';
import { loadCalendarMonthAction } from './actions';
import type { DrilldownTransaction } from './category-breakdown-chart';

/**
 * 家計簿で表示中の月(本人発案「ジャンル別の内訳も、カレンダーに連動して切り替え
 * たらその月のものを表示させて」)。カレンダーと「ジャンル別の内訳」は別のカード
 * だが、同じ月を見せる必要があるため、月と、その月の明細・内訳をここで持つ。
 *
 * 今月はページ(Server Component)が渡す最新の値をそのまま使う(保存後に
 * router.refresh() で更新される)。今月以外は月を移ったときに Server Action で
 * 取得し、月ごとにキャッシュする。
 */

type MonthData = {
  transactions: readonly DrilldownTransaction[];
  genreBreakdown: readonly GenreBreakdownRow[];
  totals: MonthTotals;
};

type SpendingMonth = MonthData & {
  /** 表示中の月の1日('YYYY-MM-DD')。 */
  visibleMonth: string;
  currentMonthStart: string;
  today: string;
  isCurrentMonth: boolean;
  loading: boolean;
  error: string | null;
  /** 月を切り替える(今月以外は明細と内訳を取りに行く)。 */
  goToMonth: (monthStart: string) => void;
  /** 表示中の月を取り直す(明細の編集後、今月以外のキャッシュを最新にする)。 */
  reloadVisibleMonth: () => void;
};

const EMPTY_TOTALS: MonthTotals = {
  spentYen: 0,
  incomeYen: 0,
  specialYen: 0,
  scheduledYen: 0,
  daySpend: {},
  scheduledDaySpend: {},
};

const SpendingMonthContext = createContext<SpendingMonth | null>(null);

export function useSpendingMonth(): SpendingMonth {
  const value = useContext(SpendingMonthContext);
  if (value === null) {
    throw new Error('useSpendingMonth は SpendingMonthProvider の中で使ってください');
  }
  return value;
}

export function SpendingMonthProvider({
  today,
  currentMonthStart,
  currentTransactions,
  currentGenreBreakdown,
  currentTotals,
  children,
}: {
  today: string;
  currentMonthStart: string;
  currentTransactions: readonly DrilldownTransaction[];
  currentGenreBreakdown: readonly GenreBreakdownRow[];
  currentTotals: MonthTotals;
  children: ReactNode;
}) {
  const [visibleMonth, setVisibleMonth] = useState(currentMonthStart);
  const [otherMonths, setOtherMonths] = useState<ReadonlyMap<string, MonthData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (monthStart: string, force: boolean) => {
    if (monthStart === currentMonthStart || (!force && otherMonths.has(monthStart))) return;
    setLoading(true);
    setError(null);
    const result = await loadCalendarMonthAction(monthStart);
    setLoading(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setOtherMonths((prev) =>
      new Map(prev).set(monthStart, {
        transactions: result.transactions,
        genreBreakdown: result.genreBreakdown,
        totals: result.totals,
      }),
    );
  };

  const isCurrentMonth = visibleMonth === currentMonthStart;
  const data: MonthData = useMemo(
    () =>
      isCurrentMonth
        ? {
            transactions: currentTransactions,
            genreBreakdown: currentGenreBreakdown,
            totals: currentTotals,
          }
        : (otherMonths.get(visibleMonth) ?? {
            transactions: [],
            genreBreakdown: [],
            totals: EMPTY_TOTALS,
          }),
    [
      isCurrentMonth,
      currentTransactions,
      currentGenreBreakdown,
      currentTotals,
      otherMonths,
      visibleMonth,
    ],
  );

  const value: SpendingMonth = {
    ...data,
    visibleMonth,
    currentMonthStart,
    today,
    isCurrentMonth,
    loading,
    error,
    goToMonth: (monthStart) => {
      setVisibleMonth(monthStart);
      void load(monthStart, false);
    },
    reloadVisibleMonth: () => void load(visibleMonth, true),
  };

  return <SpendingMonthContext.Provider value={value}>{children}</SpendingMonthContext.Provider>;
}
