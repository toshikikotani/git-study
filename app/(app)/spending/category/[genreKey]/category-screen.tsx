'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buildCategorySummary, buildInsights, type Insight } from '@/features/category/insights';
import { buildSeries, type Bucket, type ChartUnit } from '@/features/category/series';
import type { CategoryDetailData } from '@/features/category/loader';
import { actualSpentYen, buildCategoryLines, type CategoryLine } from '@/features/category/model';
import { formatMonthJa } from '@/lib/date';
import { categoryHref, isEdgeBackSwipe } from '@/lib/category-nav';
import { CategoryChart } from './category-chart';
import { CategoryHeader } from './category-header';
import { InsightsSection } from './insights-section';
import { SummarySection } from './summary-section';
import { CategoryTransactionRow } from './transaction-row';

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
  const [transactions] = useState(data.transactions);
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const [unit, setUnit] = useState<ChartUnit>('day');
  const [showPrevious, setShowPrevious] = useState(true);

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

  const focusInsight = (insight: Insight) =>
    setFocus({ ids: new Set(insight.evidenceTxIds), label: insight.focusLabel });

  const pickBucket = (b: Bucket) => {
    if (unit === 'month') {
      // 月の棒は、その月のカテゴリ詳細へ移る(別の月のデータを読み直す)。
      router.replace(categoryHref(data.genreKey, b.from) as Route, { scroll: false });
      return;
    }
    const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    setFocus({
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

      {focus ? (
        <section aria-label="根拠の取引" className="space-y-2">
          <button
            type="button"
            onClick={() => setFocus(null)}
            aria-label={`${focus.label}の絞り込みを解除`}
            className="tabular min-h-11 inline-flex items-center gap-2 rounded-full px-4 text-xs font-semibold"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--ink)',
              border: '1px solid var(--hairline)',
            }}
          >
            {focus.label}で絞り込み中<span aria-hidden>×</span>
          </button>
          <ul
            className="divider-list overflow-hidden rounded-2xl"
            style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
          >
            {shown.map((l) => (
              <CategoryTransactionRow key={l.txId} line={l} onOpen={() => {}} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
