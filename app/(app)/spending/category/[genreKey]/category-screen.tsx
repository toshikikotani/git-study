'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buildCategorySummary, buildInsights, type Insight } from '@/features/category/insights';
import { buildSeries, type Bucket, type ChartUnit } from '@/features/category/series';
import type { CategoryDetailData } from '@/features/category/loader';
import { actualSpentYen, buildCategoryLines, type CategoryLine } from '@/features/category/model';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { pickQuickDestination, useMoveCounts } from '@/features/category/destinations';
import { genreIdOfKey } from '@/features/category/model';
import { formatMonthJa } from '@/lib/date';
import { prefersReducedMotion } from '@/lib/motion';
import { categoryHref, isEdgeBackSwipe } from '@/lib/category-nav';
import { CategoryChart } from './category-chart';
import { CategoryHeader } from './category-header';
import { CategoryPicker } from './category-picker';
import { CategoryTabs, type CategoryTab } from './category-tabs';
import { EditSheet } from './edit-sheet';
import { useCategoryEdits } from './use-category-edits';
import { InsightsSection } from './insights-section';
import { SummarySection } from './summary-section';

/**
 * カテゴリ詳細の画面(クライアント側)。読み込んだ明細をここで持ち、編集・移動は
 * この状態を即座に書き換える(楽観的更新)。合計・グラフ・気づきは、この状態から
 * 家計簿と同じ集計関数で計算し直す。
 */
export function CategoryScreen({ data }: { data: CategoryDetailData }) {
  return <CategoryScreenInner key={`${data.genreKey}:${data.monthKey}`} data={data} />;
}

/** 気づき・グラフの棒から絞り込んだ取引(根拠の取引の id、または日付の範囲)。 */
export type LineFocus = {
  label: string;
  ids?: ReadonlySet<string>;
  range?: { from: string; to: string };
};

function CategoryScreenInner({ data }: { data: CategoryDetailData }) {
  const router = useRouter();
  const { transactions, ghosts, banner, dismissBanner, moveLines, moveOneItem, saveEdit } =
    useCategoryEdits({
      initial: data.transactions,
      genreKey: data.genreKey,
      genres: data.genres,
    });
  const counts = useMoveCounts();
  const [movePicker, setMovePicker] = useState<CategoryLine | null>(null);
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [showPrevious, setShowPrevious] = useState(true);
  const [tab, setTab] = useState<CategoryTab>('tx');
  const [openLine, setOpenLine] = useState<CategoryLine | null>(null);

  // 選んだ月の行と、履歴を含む全部の行(前月の比較・単価の推移に使う)。
  const lines = useMemo(
    () => buildCategoryLines(transactions, data.genreKey, data.range, data.today),
    [transactions, data.genreKey, data.range, data.today],
  );
  const historyLines = useMemo(
    () =>
      buildCategoryLines(
        transactions,
        data.genreKey,
        { from: data.windowFrom, to: data.range.to },
        data.today,
      ),
    [transactions, data.genreKey, data.windowFrom, data.range.to, data.today],
  );
  const totalYen = actualSpentYen(lines);

  const summary = useMemo(
    () =>
      buildCategorySummary({
        lines,
        historyLines,
        monthStart: data.monthStart,
        today: data.today,
        isCurrentMonth: data.isCurrentMonth,
      }),
    [lines, historyLines, data.monthStart, data.today, data.isCurrentMonth],
  );
  const insights = useMemo(
    () =>
      buildInsights({
        lines,
        historyLines,
        genreKey: data.genreKey,
        monthStart: data.monthStart,
        today: data.today,
        isCurrentMonth: data.isCurrentMonth,
      }),
    [lines, historyLines, data.genreKey, data.monthStart, data.today, data.isCurrentMonth],
  );

  const series = useMemo(
    () =>
      buildSeries({
        lines: historyLines,
        unit,
        monthStart: data.monthStart,
        monthEnd: data.range.to,
        today: data.today,
        dailyAllowanceYen:
          data.goal?.active && data.goal.row?.targetYen !== null
            ? data.goal.dailyAllowanceYen
            : null,
      }),
    [historyLines, unit, data.monthStart, data.range.to, data.today, data.goal],
  );

  const currentGenreId = genreIdOfKey(data.genreKey);
  const quickDestination = useMemo(
    () => pickQuickDestination({ counts, genres: data.genres, currentGenreId }),
    [counts, data.genres, currentGenreId],
  );

  /** 絞り込んだ取引を見せる:取引のタブへ切り替え、一覧の先頭までスクロールする。 */
  const showTransactions = (next: LineFocus) => {
    setFocus(next);
    setTab('tx');
    window.requestAnimationFrame(() =>
      document.getElementById('category-tabs')?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      }),
    );
  };

  const focusInsight = (insight: Insight) =>
    showTransactions({ ids: new Set(insight.evidenceTxIds), label: insight.focusLabel });

  const pickBucket = (b: Bucket) => {
    if (unit === 'month') {
      // 月の棒は、その月のカテゴリ詳細へ移る(別の月のデータを読み直す)。
      router.replace(categoryHref(data.genreKey, b.from) as Route, { scroll: false });
      return;
    }
    const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    showTransactions({
      range: { from: b.from, to: b.to },
      label: unit === 'day' ? md(b.from) : `${md(b.from)}〜${md(b.to)}`,
    });
  };

  // 画面の左端からのスワイプで戻る。戻ると、家計簿の元のスクロール位置に戻る。
  const edge = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      edge.current = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      const s = edge.current;
      edge.current = null;
      if (s && isEdgeBackSwipe(s.x, e.clientX - s.x, e.clientY - s.y)) router.back();
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [router]);

  const shown: CategoryLine[] = focus
    ? lines.filter(
        (l) =>
          (focus.ids === undefined || focus.ids.has(l.txId)) &&
          (focus.range === undefined ||
            (l.occurredOn >= focus.range.from && l.occurredOn <= focus.range.to)),
      )
    : [];
  const selectedIndex =
    focus?.range && unit !== 'month'
      ? series.buckets.findIndex((b) => b.from === focus.range!.from && b.to === focus.range!.to)
      : null;

  return (
    <div className="space-y-4">
      <CategoryHeader
        genreKey={data.genreKey}
        genreName={data.genreName}
        monthStart={data.monthStart}
        isCurrentMonth={data.isCurrentMonth}
        totalYen={totalYen}
        onBack={() => router.back()}
      />

      <SummarySection
        summary={summary}
        goal={data.goal}
        genreName={data.genreName}
        today={data.today}
      />

      <InsightsSection insights={insights} onFocus={focusInsight} />

      <CategoryChart
        series={series}
        genreName={data.genreName}
        monthLabel={`${data.monthStart.slice(0, 4)}年${formatMonthJa(data.monthKey)}`}
        showPrevious={showPrevious}
        onShowPrevious={setShowPrevious}
        onUnit={setUnit}
        onPick={pickBucket}
        selectedIndex={selectedIndex !== null && selectedIndex >= 0 ? selectedIndex : null}
      />

      <CategoryTabs
        genreKey={data.genreKey}
        lines={lines}
        historyLines={historyLines}
        tab={tab}
        onTab={setTab}
        focusedLines={focus ? shown : null}
        focusLabel={focus?.label ?? null}
        onClearFocus={() => setFocus(null)}
        onOpenLine={setOpenLine}
        quickDestination={quickDestination}
        onQuickMove={(line) => quickDestination && void moveLines([line], quickDestination.id)}
        onMoveMenu={setMovePicker}
        ghostLines={ghosts}
        onFocusStore={(store) =>
          showTransactions({ ids: new Set(store.txIds), label: store.label })
        }
      />

      {banner ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl p-4 text-sm"
          style={{ background: 'var(--attention-track)', border: '1px solid var(--state-caution)' }}
        >
          <span style={{ color: 'var(--ink)' }}>
            <span aria-hidden>▲ </span>
            {banner}
          </span>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="閉じる"
            className="min-h-11 min-w-11"
          >
            ×
          </button>
        </div>
      ) : null}

      <EditSheet
        line={openLine}
        genres={data.genres}
        suggestedGenreId={quickDestination?.id ?? null}
        onClose={() => setOpenLine(null)}
        onSave={(line, patch) => {
          setOpenLine(null);
          void saveEdit(line, patch);
        }}
        onMove={(line, to) => {
          setOpenLine(null);
          void moveLines([line], to);
        }}
        onMoveItem={(line, itemId, to) => {
          setOpenLine(null);
          void moveOneItem(line, itemId, to);
        }}
      />

      {/* 左スワイプの「カテゴリを移す」:格子から1タップ */}
      <BottomSheet open={movePicker !== null} onClose={() => setMovePicker(null)} role="dialog">
        <div className="space-y-2 px-3 pb-3">
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {movePicker?.label} のカテゴリを移す
          </p>
          <CategoryPicker
            genres={data.genres}
            currentId={currentGenreId}
            suggestedId={quickDestination?.id ?? null}
            includeUncategorized
            onPick={(to) => {
              const line = movePicker;
              setMovePicker(null);
              if (line) void moveLines([line], to);
            }}
          />
        </div>
      </BottomSheet>
    </div>
  );
}
