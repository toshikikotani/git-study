'use client';

import type { CaptureView } from '@/features/receipt-captures/types';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { GenreOption } from '@/features/genre/store';
import type { GenreBreakdownRow, MonthTotals } from '@/features/spending/ledger-types';
import { EMPTY_FILTER, type LedgerFilter } from '@/features/spending/views';
import { VIEW_STATE_KEY, parseViewState, serializeViewState } from '@/lib/scroll';
import { loadCalendarMonthAction } from './actions';
import type { DrilldownTransaction } from './drilldown';

/**
 * 家計簿で表示中の月と、明細の絞り込みの状態。
 *
 * 期間の切り替え(‹ 9月 ›)・サマリー・ジャンル内訳・カレンダー・明細リストは
 * すべて同じ月を見せる。表示中の月と、その月の明細・内訳・合計をここで持つ
 * (どれも domain/ledger.ts の集計関数から作った値で、画面ごとに足し直さない)。
 * 絞り込み(ジャンル・日付・口座・目標期間・検索)も1つの状態で、内訳やカレンダーで
 * タップすると明細リストがその条件に絞られる。
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
  genres: readonly GenreOption[];
  accounts: readonly { id: string; name: string }[];
  /** 入力待ちのレシート(読み取れなかったもの)。集計・目標には入らない。 */
  captures: readonly CaptureView[];
  /** 月を切り替える(今月以外は明細と内訳を取りに行く)。 */
  goToMonth: (monthStart: string) => void;
  /** 表示中の月を取り直す(明細の編集後、今月以外のキャッシュを最新にする)。 */
  reloadVisibleMonth: () => void;
  filter: LedgerFilter;
  setFilter: (patch: Partial<LedgerFilter>) => void;
  clearFilter: () => void;
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
  genres,
  accounts,
  captures = [],
  initialFilter,
  children,
}: {
  today: string;
  currentMonthStart: string;
  currentTransactions: readonly DrilldownTransaction[];
  currentGenreBreakdown: readonly GenreBreakdownRow[];
  currentTotals: MonthTotals;
  genres: readonly GenreOption[];
  accounts: readonly { id: string; name: string }[];
  /** 入力待ちのレシート(読み取れなかったもの)。 */
  captures?: readonly CaptureView[];
  /** 絞り込みの初期値(テスト用)。 */
  initialFilter?: Partial<LedgerFilter>;
  children: ReactNode;
}) {
  const [visibleMonth, setVisibleMonth] = useState(currentMonthStart);
  const [otherMonths, setOtherMonths] = useState<ReadonlyMap<string, MonthData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<LedgerFilter>({
    ...EMPTY_FILTER,
    ...initialFilter,
  });

  // 家計簿を離れて戻ったとき(レシートの入力・目標画面などから)、絞り込みとスクロール位置を復元する。
  useEffect(() => {
    if (initialFilter !== undefined) return;
    try {
      const saved = parseViewState(window.sessionStorage.getItem(VIEW_STATE_KEY), Date.now());
      if (saved === null) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部(sessionStorage)からの一度きりの復元
      setFilterState(saved.filter);
      window.requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
    } catch {
      // 復元できなくても通常どおり開く
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アプリのバッジ(ホーム画面のアイコン)に、入力待ちのレシートの件数を出す(対応する環境だけ)。
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (captures.length > 0) void nav.setAppBadge?.(captures.length)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  }, [captures.length]);

  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => {
    let timer: number | undefined;
    const save = () => {
      try {
        window.sessionStorage.setItem(
          VIEW_STATE_KEY,
          serializeViewState({
            filter: filterRef.current,
            scrollY: window.scrollY,
            savedAt: Date.now(),
          }),
        );
      } catch {
        // 保存できなくても復元されないだけ
      }
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 150);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      window.clearTimeout(timer);
      save();
    };
  }, []);

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
    genres,
    accounts,
    captures,
    goToMonth: (monthStart) => {
      setVisibleMonth(monthStart);
      // 月が変わったら、日付・ジャンルの絞り込みは外す(別の月の日付は無意味)。
      setFilterState((f) => ({ ...f, date: null, genreId: null }));
      void load(monthStart, false);
    },
    reloadVisibleMonth: () => void load(visibleMonth, true),
    filter,
    setFilter: (patch) => setFilterState((f) => ({ ...f, ...patch })),
    clearFilter: () => setFilterState(EMPTY_FILTER),
  };

  return <SpendingMonthContext.Provider value={value}>{children}</SpendingMonthContext.Provider>;
}
