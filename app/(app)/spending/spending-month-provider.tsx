'use client';

import type { CaptureView } from '@/features/receipt-captures/types';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
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
import { resolveCalendarMonthStart, validMonthKey } from '@/lib/period-nav';
import { parseViewState, serializeViewState, viewStateKey } from '@/lib/scroll';
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
  initialMonth,
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
  /** URLで指定された月。過去月はマウント後に同じ集計を読み込む。 */
  initialMonth?: string;
  /** 絞り込みの初期値(テスト用)。 */
  initialFilter?: Partial<LedgerFilter>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const requestedMonth = useSearchParams().get('month');
  const storageKey = viewStateKey(pathname);
  const initialMonthStart = resolveCalendarMonthStart(initialMonth?.slice(0, 7), currentMonthStart);
  const [visibleMonth, setVisibleMonth] = useState(initialMonthStart);
  const [otherMonths, setOtherMonths] = useState<ReadonlyMap<string, MonthData>>(new Map());
  const cacheRef = useRef<ReadonlyMap<string, MonthData>>(new Map());
  const monthRef = useRef(initialMonthStart);
  const requestRef = useRef(0);
  const pendingScrollRef = useRef<{ month: string; y: number } | null>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const syncedUrlMonthRef = useRef<string | null>(requestedMonth);
  const syncedInitialMonthRef = useRef(initialMonth);
  const [loading, setLoading] = useState(initialMonthStart !== currentMonthStart);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<LedgerFilter>({
    ...EMPTY_FILTER,
    ...initialFilter,
  });

  const load = useCallback(
    async (monthStart: string, force: boolean) => {
      const request = ++requestRef.current;
      setError(null);
      if (monthStart === currentMonthStart || (!force && cacheRef.current.has(monthStart))) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await loadCalendarMonthAction(monthStart);
        if (result.error !== null) {
          if (request === requestRef.current) setError(result.error);
          return;
        }
        const next = new Map(cacheRef.current).set(monthStart, {
          transactions: result.transactions,
          genreBreakdown: result.genreBreakdown,
          totals: result.totals,
        });
        cacheRef.current = next;
        setOtherMonths(next);
      } catch {
        if (request === requestRef.current) setError('この月の明細を読み込めませんでした。');
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [currentMonthStart],
  );

  // URLの月を優先し、同じ月なら保存していた条件・位置も戻す。
  useEffect(() => {
    if (restoredKeyRef.current === storageKey) return;
    restoredKeyRef.current = storageKey;
    const urlMonth = validMonthKey(requestedMonth);
    syncedUrlMonthRef.current = requestedMonth;
    syncedInitialMonthRef.current = initialMonth;
    try {
      const saved = parseViewState(window.sessionStorage.getItem(storageKey), Date.now());
      const month = resolveCalendarMonthStart(
        urlMonth ?? saved?.monthStart?.slice(0, 7) ?? initialMonth?.slice(0, 7),
        currentMonthStart,
      );
      monthRef.current = month;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部(sessionStorage)からの一度きりの復元
      setVisibleMonth(month);
      if (
        saved !== null &&
        initialFilter === undefined &&
        (urlMonth === null || saved.monthStart === month)
      ) {
        setFilterState(saved.filter);
        pendingScrollRef.current = { month, y: saved.scrollY };
      }
      void load(month, false);
    } catch {
      // sessionStorageが無効でもURLの月は引き継ぐ。
      const month = resolveCalendarMonthStart(
        urlMonth ?? initialMonth?.slice(0, 7),
        currentMonthStart,
      );
      monthRef.current = month;
      setVisibleMonth(month);
      void load(month, false);
    }
  }, [storageKey, currentMonthStart, initialFilter, initialMonth, requestedMonth, load]);

  // 同じページへのリンク・ブラウザの戻る/進むでも、URLに指定された月へ追従する。
  // 内部の月切替は先にrefを更新するので、同じ月の二重読み込みをしない。
  useEffect(() => {
    if (
      syncedUrlMonthRef.current === requestedMonth &&
      syncedInitialMonthRef.current === initialMonth
    )
      return;
    syncedUrlMonthRef.current = requestedMonth;
    syncedInitialMonthRef.current = initialMonth;
    const month = resolveCalendarMonthStart(
      requestedMonth ?? initialMonth?.slice(0, 7),
      currentMonthStart,
    );
    if (month === monthRef.current) return;
    monthRef.current = month;
    pendingScrollRef.current = null;
    setVisibleMonth(month);
    setFilterState((f) => ({ ...f, date: null, genreId: null }));
    void load(month, false);
  }, [requestedMonth, initialMonth, currentMonthStart, load]);

  // 過去月の明細を読み終えてから位置を戻す(空の画面では高さが足りない)。
  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (
      pending === null ||
      pending.month !== visibleMonth ||
      loading ||
      (visibleMonth !== currentMonthStart && !otherMonths.has(visibleMonth))
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, pending.y);
      pendingScrollRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleMonth, currentMonthStart, loading, otherMonths]);

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
          storageKey,
          serializeViewState({
            monthStart: monthRef.current,
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
  }, [storageKey]);

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
      monthRef.current = monthStart;
      pendingScrollRef.current = null;
      setVisibleMonth(monthStart);
      const url = new URL(window.location.href);
      url.searchParams.set('month', monthStart.slice(0, 7));
      syncedUrlMonthRef.current = monthStart.slice(0, 7);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
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
