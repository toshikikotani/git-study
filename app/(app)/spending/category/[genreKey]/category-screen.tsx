'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buildCategorySummary, buildInsights, type Insight } from '@/features/category/insights';
import { buildCumulative, categoryAllowanceYen, goalOverlaps } from '@/features/category/pace';
import { buildSeries, type Bucket, type ChartUnit } from '@/features/category/series';
import type { CategoryDetailData } from '@/features/category/loader';
import { actualSpentYen, buildCategoryLines, type CategoryLine } from '@/features/category/model';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Yen } from '@/components/ui/money';
import { CONFIDENT, predictGenres, type GenrePrediction } from '@/domain/genre-prediction';
import { suggestRule, type RuleSuggestion } from '@/domain/rule-match';
import { hapticFor } from '@/lib/haptics';
import { pickQuickDestination, useMoveCounts } from '@/features/category/destinations';
import { genreIdOfKey } from '@/features/category/model';
import { formatMonthJa } from '@/lib/date';
import { prefersReducedMotion } from '@/lib/motion';
import { categoryHref, isEdgeBackSwipe } from '@/lib/category-nav';
import { categoryVoiceOverLabel, useOnline } from '@/features/category/a11y';
import { CategoryChart, type ChartMode } from './category-chart';
import { CategoryHeader } from './category-header';
import { CategoryPicker } from './category-picker';
import { setCategoryForecastClosedAction } from '../actions';
import { CategorySettings } from './category-settings';
import { CategoryTabs, type CategoryTab } from './category-tabs';
import { EditSheet } from './edit-sheet';
import { RuleSheet } from './rule-sheet';
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
  const {
    transactions,
    ghosts,
    banner,
    dismissBanner,
    moveLines,
    moveOneItem,
    saveEdit,
    moveMany,
    deleteLines,
    applyRuleResult,
  } = useCategoryEdits({
    initial: data.transactions,
    genreKey: data.genreKey,
    genres: data.genres,
  });
  const counts = useMoveCounts();
  const [movePicker, setMovePicker] = useState<CategoryLine | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const online = useOnline();
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative');
  const [showPrevious, setShowPrevious] = useState(true);
  const [tab, setTab] = useState<CategoryTab>('tx');
  const [openLine, setOpenLine] = useState<CategoryLine | null>(null);
  // まとめて修正:選択モード(なぞって選べる)、選んだ行、一括の移動・削除、ルールの提案。
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkPicker, setBulkPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rule, setRule] = useState<{
    suggestion: RuleSuggestion;
    toGenre: { id: string; name: string };
  } | null>(null);

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

  // 目標期間中の、このカテゴリの1日の目安(全カテゴリ合計の目安ではない)。表示中の期間が
  // 目標期間と重なるときだけ。
  const categoryAllowance = useMemo(() => {
    const g = data.goal;
    if (!g || !g.active || !g.row || g.row.targetYen === null) return null;
    if (!goalOverlaps(g.range, data.monthStart, data.range.to)) return null;
    return categoryAllowanceYen({
      budgetYen: g.row.targetYen,
      scheduledYen: g.row.scheduledYen,
      lines: historyLines,
      goalRange: g.range,
      today: data.today,
    });
  }, [data.goal, data.monthStart, data.range.to, data.today, historyLines]);

  const series = useMemo(
    () =>
      buildSeries({
        lines: historyLines,
        unit,
        monthStart: data.monthStart,
        monthEnd: data.range.to,
        today: data.today,
        dailyAllowanceYen: categoryAllowance,
      }),
    [historyLines, unit, data.monthStart, data.range.to, data.today, categoryAllowance],
  );

  const cumulative = useMemo(
    () =>
      buildCumulative({
        lines: historyLines,
        monthStart: data.monthStart,
        monthEnd: data.range.to,
        today: data.today,
        recordStart: series.recordStart,
        goal:
          data.goal?.active && data.goal.row && data.goal.row.targetYen !== null
            ? { range: data.goal.range, budgetYen: data.goal.row.targetYen }
            : null,
        holdForecast: data.forecastClosed,
      }),
    [
      historyLines,
      data.monthStart,
      data.range.to,
      data.today,
      series.recordStart,
      data.goal,
      data.forecastClosed,
    ],
  );

  const currentGenreId = genreIdOfKey(data.genreKey);
  const quickDestination = useMemo(
    () => pickQuickDestination({ counts, genres: data.genres, currentGenreId }),
    [counts, data.genres, currentGenreId],
  );

  const nameOfGenre = (id: string) => data.genres.find((g) => g.id === id)?.name ?? '';

  /** このカテゴリに属する品目の名前(移した部分の品目)。 */
  const itemNamesOf = (l: CategoryLine): string[] =>
    l.tx.items.filter((i) => (i.genreId ?? l.tx.genreId) === currentGenreId).map((i) => i.name);

  /** カテゴリを移し、成功したら、ルール化を提案する。 */
  const moveWithRule = async (targets: readonly CategoryLine[], toGenreId: string | null) => {
    const ok = await moveLines(targets, toGenreId);
    if (!ok || toGenreId === null) return ok;
    const suggestion = suggestRule(
      targets.map((l) => ({ storeName: l.label, itemNames: itemNamesOf(l) })),
      nameOfGenre(toGenreId),
    );
    if (suggestion)
      setRule({ suggestion, toGenre: { id: toGenreId, name: nameOfGenre(toGenreId) } });
    return ok;
  };

  const moveItemWithRule = async (line: CategoryLine, itemId: string, toGenreId: string | null) => {
    const ok = await moveOneItem(line, itemId, toGenreId);
    if (!ok || toGenreId === null) return ok;
    const name = line.tx.items.find((i) => i.id === itemId)?.name;
    const suggestion = suggestRule(
      [{ storeName: line.label, itemNames: name ? [name] : [] }],
      nameOfGenre(toGenreId),
    );
    if (suggestion)
      setRule({ suggestion, toGenre: { id: toGenreId, name: nameOfGenre(toGenreId) } });
    return ok;
  };

  // 未分類の画面:行ごとの予測(上位3件)と、信頼度0.9以上だけの一括確定。
  const isUncategorizedScreen = data.genreKey === 'none';
  const predictionMap = useMemo(() => {
    const map = new Map<string, GenrePrediction[]>();
    if (!isUncategorizedScreen) return map;
    for (const l of lines) {
      if (l.status !== 'actual' || l.amountYen >= 0) continue;
      map.set(
        l.txId,
        predictGenres({
          storeName: l.label,
          itemNames: l.tx.items.map((i) => i.name),
          genres: data.genres,
          history: data.genreHistory,
        }),
      );
    }
    return map;
  }, [isUncategorizedScreen, lines, data.genres, data.genreHistory]);
  const confident = useMemo(
    () =>
      lines.flatMap((l) => {
        const top = predictionMap.get(l.txId)?.[0];
        return top && top.confidence >= CONFIDENT ? [{ line: l, toGenreId: top.genreId }] : [];
      }),
    [lines, predictionMap],
  );

  const selectedLines = lines.filter((l) => selectedIds.has(l.txId) && l.status === 'actual');
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

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
      <p className="sr-only">
        {categoryVoiceOverLabel({
          genreName: data.genreName,
          monthKey: data.monthKey,
          totalYen,
          count: summary.count,
        })}
      </p>
      {online ? null : (
        <p
          role="status"
          className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-secondary)' }}
        >
          オフラインです。最後に読み込んだ内容を表示しています。変更は通信できるようになってから行えます。
        </p>
      )}
      <CategoryHeader
        genreKey={data.genreKey}
        genreName={data.genreName}
        monthStart={data.monthStart}
        isCurrentMonth={data.isCurrentMonth}
        todayMonthKey={data.today.slice(0, 7)}
        totalYen={totalYen}
        onBack={() => router.back()}
        menu={
          <div className="flex flex-wrap items-center">
            <button
              type="button"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              aria-pressed={selectMode}
              className="min-h-11 rounded-full px-4 text-sm font-semibold whitespace-nowrap"
              style={{ color: 'var(--ink)' }}
            >
              {selectMode ? '完了' : '選択'}
            </button>
            {currentGenreId !== null ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={`${data.genreName}の設定`}
                className="min-h-11 rounded-full px-3 text-sm font-semibold whitespace-nowrap"
                style={{ color: 'var(--ink)' }}
              >
                設定
              </button>
            ) : null}
          </div>
        }
      />

      {isUncategorizedScreen && confident.length > 0 ? (
        <button
          type="button"
          onClick={() => void moveMany(confident)}
          className="min-h-12 w-full rounded-2xl text-base font-semibold"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
        >
          すべて予測どおりに確定({confident.length}件)
        </button>
      ) : null}

      {data.genreName.includes('食料')
        ? lines
            .filter(
              (l) => l.status === 'actual' && /ショコラ|菓子|ケーキ|sucr|カフェ/i.test(l.label),
            )
            .slice(0, 1)
            .map((l) => (
              <p
                key={l.txId}
                className="text-sm leading-relaxed"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {l.label} {Math.abs(l.amountYen).toLocaleString('ja-JP')}
                円は菓子店です。カフェ・飲料へ移すと、食料の注意は消えます。
              </p>
            ))
        : null}
      <SummarySection
        summary={summary}
        goal={data.goal}
        monthStart={data.monthStart}
        monthEnd={data.range.to}
        genreName={data.genreName}
        today={data.today}
      />

      <InsightsSection insights={insights} onFocus={focusInsight} />

      <CategoryChart
        series={series}
        cumulative={cumulative}
        mode={chartMode}
        onMode={setChartMode}
        genreName={data.genreName}
        monthLabel={`${data.monthStart.slice(0, 4)}年${formatMonthJa(data.monthKey)}`}
        showPrevious={showPrevious}
        onShowPrevious={setShowPrevious}
        onUnit={setUnit}
        onPick={pickBucket}
        selectedIndex={selectedIndex !== null && selectedIndex >= 0 ? selectedIndex : null}
        budgetYen={data.goal?.row?.targetYen ?? null}
        holdForecast={data.forecastClosed}
        {...(currentGenreId
          ? {
              onHoldForecast: () =>
                void setCategoryForecastClosedAction(currentGenreId, !data.forecastClosed).then(
                  () => router.refresh(),
                ),
            }
          : {})}
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
        onOpenLine={(line) => {
          if (!selectMode) {
            setOpenLine(line);
            return;
          }
          // 選択モード:タップで選択を切り替える
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(line.txId)) next.delete(line.txId);
            else next.add(line.txId);
            return next;
          });
        }}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onSelectedChange={setSelectedIds}
        {...(isUncategorizedScreen
          ? {
              predictionsFor: (l: CategoryLine) => predictionMap.get(l.txId) ?? [],
              onPredict: (l: CategoryLine, genreId: string) => void moveWithRule([l], genreId),
            }
          : {})}
        quickDestination={quickDestination}
        onQuickMove={(line) => quickDestination && void moveWithRule([line], quickDestination.id)}
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
          void moveWithRule([line], to);
        }}
        onMoveItem={(line, itemId, to) => {
          setOpenLine(null);
          void moveItemWithRule(line, itemId, to);
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
              if (line) void moveWithRule([line], to);
            }}
          />
        </div>
      </BottomSheet>

      {/* まとめて修正:選択モードのあいだ、下部に固定(選択件数・合計・操作) */}
      {selectMode ? (
        <div
          role="toolbar"
          aria-label="選択した取引の操作"
          className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl px-4 py-2"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 112px)',
            background: 'var(--surface-raised)',
            boxShadow: 'var(--glass-shadow-float)',
            border: '1px solid var(--hairline)',
          }}
        >
          <p
            className="tabular min-w-0 text-sm"
            style={{ color: 'var(--ink)' }}
            aria-live="polite"
            aria-label={`${selectedLines.length}件を選択、合計${Math.abs(actualSpentYen(selectedLines)).toLocaleString('ja-JP')}円`}
          >
            {selectedLines.length}件
            <span className="ml-2" style={{ color: 'var(--ink-secondary)' }}>
              <Yen value={actualSpentYen(selectedLines)} />
            </span>
          </p>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={selectedLines.length === 0}
              onClick={() => setBulkPicker(true)}
              className="min-h-11 rounded-full px-3 text-sm font-semibold disabled:opacity-40"
              style={{ color: 'var(--ink)' }}
            >
              カテゴリを移す
            </button>
            <button
              type="button"
              disabled={selectedLines.length === 0}
              onClick={() => setConfirmDelete(true)}
              className="min-h-11 rounded-full px-3 text-sm font-semibold disabled:opacity-40"
              style={{ color: 'var(--over)' }}
            >
              削除
            </button>
          </span>
        </div>
      ) : null}

      <BottomSheet open={bulkPicker} onClose={() => setBulkPicker(false)} role="dialog">
        <div className="space-y-2 px-3 pb-3">
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {selectedLines.length}件のカテゴリを移す
          </p>
          <CategoryPicker
            genres={data.genres}
            currentId={currentGenreId}
            suggestedId={quickDestination?.id ?? null}
            includeUncategorized
            onPick={(to) => {
              const targets = selectedLines;
              setBulkPicker(false);
              exitSelect();
              void moveWithRule(targets, to).then((ok) => ok && hapticFor('bulkComplete'));
            }}
          />
        </div>
      </BottomSheet>

      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} role="dialog">
        <div className="space-y-3 px-3 pb-3">
          <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {selectedLines.length}件を削除しますか?
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            削除した直後なら、元に戻せます。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink)' }}
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => {
                const targets = selectedLines;
                setConfirmDelete(false);
                exitSelect();
                hapticFor('deleteConfirm');
                void deleteLines(targets);
              }}
              className="min-h-11 flex-1 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--over)', color: 'var(--on-action)' }}
            >
              削除する
            </button>
          </div>
        </div>
      </BottomSheet>

      {currentGenreId !== null ? (
        <CategorySettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          data={data}
          genreId={currentGenreId}
        />
      ) : null}

      <RuleSheet
        suggestion={rule?.suggestion ?? null}
        toGenre={rule?.toGenre ?? null}
        onClose={() => setRule(null)}
        onApplied={(scope, toGenreId, ids) => applyRuleResult(scope, toGenreId, ids)}
      />
    </div>
  );
}
