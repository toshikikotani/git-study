'use client';

import { useEffect, useRef, useState } from 'react';

import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { Segmented } from '@/components/ui/segmented';
import { genreBarColor, genreColorVar } from '@/domain/genre-style';
import { pickAxisLabels } from '@/features/category/axis';
import {
  TAG_HEIGHT,
  TICK_HEIGHT,
  formatAxisYen,
  layoutGutter,
  plotHeightFor,
  type GutterItem,
} from '@/features/category/chart-layout';
import { cumulativeTooltip, idealDeltaLabel, type CumulativeChart } from '@/features/category/pace';
import {
  AUDIO_NOTE_MS,
  CHART_UNITS,
  MAX_BARS,
  audioGraphPlan,
  barRatio,
  bucketTooltip,
  summarizeSeries,
  type Bucket,
  type ChartUnit,
  type Series,
} from '@/features/category/series';
import { useFontScale } from '@/lib/font-scale';
import { hapticFor } from '@/lib/haptics';
import { DeltaLabel, type DeltaGeometry, type Pt } from './delta-label';
import { ChartGesture } from '@/lib/chart-gesture';

/** 右端の余白(金額の目盛りと、目安・平均のタグ)。描画領域の外側に確保する。文字の大きさに合わせて広がる(ch)。 */
const GUTTER_W = 'calc(6ch + 12px)';
const GAP = 0.18; // 棒の間の隙間(区間の幅に対する割合)
const BAR_MAX_PX = 12; // 棒の幅の上限
const BAR_RADIUS = 4; // 棒の上端の角丸

export type ChartMode = 'cumulative' | 'daily';

const MODES: readonly { value: ChartMode; label: string }[] = [
  { value: 'cumulative', label: '累計' },
  { value: 'daily', label: '日別' },
];

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 触って読めるグラフ。初めは「累計」:実線=このカテゴリの支出の累計、点線=理想ペース、
 * 先頭の点の横に「理想より○円少ない / 多い」。今月は、今日より先を薄い帯(日平均の ±20%)で
 * 予測し、予定の支出は白抜きの段差で示す。「日別」では、棒(上端4pt・幅は最大12pt)で日・週・月を
 * 見せ、目安を超えた分だけを注意の色に塗り分ける。予定は斜線の棒。
 * 横軸は記録開始日から(左端に「9/21 記録開始」)。ラベルは最大5個で折り返さない。
 * 長押しして指でなぞると、なぞっている区間の日付・金額を吹き出しで見せ、区間が変わるたびに
 * 選択の触覚を返す。棒は31本ぶんの部品を使い回し、単位を切り替えると形が滑らかに変わる。
 * 読み上げ:グラフの要約と、区間ごとのボタン(金額・件数)。
 */
export function CategoryChart({
  series,
  cumulative,
  mode,
  onMode,
  genreName,
  monthLabel,
  showPrevious,
  onShowPrevious,
  onUnit,
  onPick,
  selectedIndex,
}: {
  series: Series;
  cumulative: CumulativeChart;
  mode: ChartMode;
  onMode: (mode: ChartMode) => void;
  genreName: string;
  monthLabel: string;
  showPrevious: boolean;
  onShowPrevious: (on: boolean) => void;
  onUnit: (unit: ChartUnit) => void;
  onPick: (bucket: Bucket) => void;
  selectedIndex: number | null;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const fontScale = useFontScale();
  const plotPx = plotHeightFor(fontScale);
  // 文字が大きいとき、点の横には収まらない。グラフの上の固定の置き場に、折り返してよい形で出す。
  const bigText = fontScale >= 1.5;
  const [plotW, setPlotW] = useState(280);
  const [tip, setTip] = useState<number | null>(null);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const isCum = mode === 'cumulative';
  const n = isCum ? cumulative.days.length : series.buckets.length;
  const overrides = useGenreOverrides();
  const override = genreName === '未分類' ? null : overrides[genreName];
  const barColor = genreBarColor(genreName === '未分類' ? null : genreName, override);
  const lineColor = genreColorVar(genreName === '未分類' ? null : genreName, override);
  const maxYen = isCum ? cumulative.maxYen : series.maxYen;
  const ticks = isCum ? cumulative.ticks : series.ticks;

  // なぞり操作(長押し・なぞる・タップ)の状態機械。DOM に触れない(lib/chart-gesture.ts)。
  const [gesture] = useState(() => new ChartGesture());
  useEffect(() => {
    gesture.configure({
      bucketCount: n,
      geometry: () => {
        const r = plot.current?.getBoundingClientRect();
        return { left: r?.left ?? 0, width: r?.width ?? 1 };
      },
      pickable: (i) =>
        isCum
          ? cumulative.days[i]?.actualYen !== null && cumulative.days[i] !== undefined
          : series.buckets[i] !== undefined && !series.buckets[i]!.future,
      onTip: setTip,
      onHaptic: () => hapticFor('chartScrub'),
      onPick: (i) => {
        if (!isCum && series.buckets[i]) onPick(series.buckets[i]!);
      },
    });
  }, [gesture, n, series, cumulative, isCum, onPick]);

  // 描画領域の幅(横軸のラベルを間引く目安)。
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPlotW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // なぞっている間は、ページが縦にスクロールしないようにする。
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (gesture.isScrubbing) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [gesture]);

  const summary = isCum
    ? `${monthLabel}の${genreName}、累計。${
        cumulative.endIndex !== null
          ? `${cumulative.days[cumulative.endIndex]!.actualYen!.toLocaleString('ja-JP')}円`
          : '支出はありません'
      }${cumulative.deltaYen !== null ? `。${idealDeltaLabel(cumulative.deltaYen)}` : ''}`
    : summarizeSeries(series, genreName, monthLabel);

  let tipText: string | null = null;
  if (tip !== null) {
    if (isCum) {
      const d = cumulative.days[tip];
      const prev = tip > 0 ? cumulative.days[tip - 1]?.actualYen : 0;
      tipText =
        d && d.actualYen !== null
          ? cumulativeTooltip(cumulative, tip, d.actualYen - (prev ?? 0))
          : null;
    } else if (series.buckets[tip]) {
      tipText = bucketTooltip(series.buckets[tip]!, series.unit);
    }
  }

  const playAudio = () => {
    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctx) {
      setAudioNote('この環境では音を出せません。');
      return;
    }
    setAudioNote(null);
    const ctx = new Ctx();
    const plan = audioGraphPlan(
      isCum ? cumulative.days.map((d) => d.actualYen ?? 0) : series.buckets.map((b) => b.actualYen),
    );
    const t0 = ctx.currentTime + 0.05;
    for (const note of plan) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = note.frequencyHz;
      gain.gain.value = 0.12;
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + note.startMs / 1000);
      osc.stop(t0 + (note.startMs + note.durationMs) / 1000);
    }
    window.setTimeout(() => void ctx.close(), plan.length * AUDIO_NOTE_MS + 300);
  };

  // 横軸のラベル(最大5個・折り返さない・重ならない)。記録開始日には「記録開始」を添える。
  const axisLabels = isCum
    ? cumulative.days.map((d) => md(d.date))
    : series.buckets.map((b) => b.label);
  const startNote =
    (isCum ? cumulative.recordStartInMonth : series.recordStartInMonth) && series.unit !== 'month'
      ? `${axisLabels[0]} 記録開始`
      : undefined;
  const axis = pickAxisLabels(
    axisLabels,
    plotW,
    isCum || series.unit !== 'month' ? startNote : undefined,
    5,
    7.5 * fontScale,
  );

  const x = (i: number) => ((i + 0.5) / Math.max(n, 1)) * 100;
  const y = (v: number) => 100 - (Math.min(Math.max(v, 0), maxYen) / maxYen) * 100;

  const end = cumulative.endIndex !== null ? cumulative.days[cumulative.endIndex]! : null;

  // 「理想より○円少ない / 多い」を、線・帯と重ならない位置に置くための図形(描画領域に対する%)。
  let deltaGeometry: DeltaGeometry | null = null;
  if (isCum && end && end.actualYen !== null) {
    const e: Pt = [x(end.index), y(end.actualYen)];
    const fut = cumulative.days.filter((d) => d.forecastHighYen !== null);
    deltaGeometry = {
      end: e,
      lines: [
        cumulative.days
          .filter((d) => d.actualYen !== null)
          .map((d): Pt => [x(d.index), y(d.actualYen!)]),
        cumulative.days
          .filter((d) => d.idealYen !== null)
          .map((d): Pt => [x(d.index), y(d.idealYen!)]),
        fut.length > 0 ? [e, ...fut.map((d): Pt => [x(d.index), y(d.forecastYen!)])] : [],
      ],
      band:
        fut.length > 0
          ? [
              e,
              ...fut.map((d): Pt => [x(d.index), y(d.forecastHighYen!)]),
              ...[...fut].reverse().map((d): Pt => [x(d.index), y(d.forecastLowYen!)]),
            ]
          : null,
    };
  }

  const gutterItems: GutterItem[] = [
    ...ticks.map((t) => ({
      key: `tick-${t}`,
      kind: 'tick' as const,
      ratio: t / maxYen,
      height: TICK_HEIGHT * fontScale,
    })),
    ...(!isCum && series.allowanceYen !== null
      ? [
          {
            key: 'allowance',
            kind: 'tag' as const,
            ratio: series.allowanceYen / maxYen,
            height: TAG_HEIGHT * fontScale,
          },
        ]
      : []),
    ...(!isCum && series.averageLineYen !== null
      ? [
          {
            key: 'average',
            kind: 'tag' as const,
            ratio: series.averageLineYen / maxYen,
            height: TAG_HEIGHT * fontScale,
          },
        ]
      : []),
  ];
  const placed = layoutGutter(gutterItems, plotPx);

  return (
    <section
      aria-label="グラフ"
      className="space-y-3 rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={mode} options={MODES} onChange={onMode} label="グラフの表示" />
        {isCum ? null : (
          <Segmented
            value={series.unit}
            options={CHART_UNITS}
            onChange={(u) => {
              if (series.unit !== u) hapticFor('tabChange');
              onUnit(u);
            }}
            label="グラフの単位"
          />
        )}
      </div>
      {isCum ? null : (
        <label
          className="flex min-h-11 items-center gap-2 text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <input
            type="checkbox"
            checked={showPrevious && series.hasPrevious}
            disabled={!series.hasPrevious}
            onChange={(e) => onShowPrevious(e.target.checked)}
            className="size-5 disabled:opacity-40"
          />
          <span>
            前期間と比べる
            {series.hasPrevious ? null : (
              <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>
                前月のデータがありません
              </span>
            )}
          </span>
        </label>
      )}

      <div role="group" aria-label={summary}>
        {/* なぞっている間の吹き出し。位置は動かさず、グラフの上部に固定する(データと重ならない) */}
        <div className="flex min-h-8 items-center" style={{ paddingRight: GUTTER_W }}>
          {!tipText && bigText && isCum && cumulative.deltaYen !== null ? (
            <p
              data-chart-label="delta"
              data-may-wrap
              className="text-xs font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              <span aria-hidden style={{ color: lineColor }}>
                ●{' '}
              </span>
              {idealDeltaLabel(cumulative.deltaYen)}
            </p>
          ) : null}
          {tipText ? (
            <p
              role="status"
              data-chart-label="tooltip"
              className="tabular rounded-xl px-3 py-1 text-xs font-semibold whitespace-nowrap"
              style={{ background: 'var(--ink)', color: 'var(--surface)' }}
            >
              {tipText}
            </p>
          ) : null}
        </div>
        <div className="relative text-xs" style={{ height: plotPx, paddingRight: GUTTER_W }}>
          <div
            ref={plot}
            className="relative h-full w-full touch-pan-y select-none"
            onPointerDown={(e) => gesture.pointerDown(e.clientX, e.clientY)}
            onPointerMove={(e) => {
              if (gesture.isScrubbing) plot.current?.setPointerCapture?.(e.pointerId);
              gesture.pointerMove(e.clientX, e.clientY, e.pointerType);
            }}
            onPointerUp={(e) => gesture.pointerUp(e.clientX, e.clientY)}
            onPointerLeave={() => gesture.pointerLeave()}
            onPointerCancel={() => gesture.cancel()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* 横の補助線 */}
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className="pointer-events-none absolute inset-x-0"
                style={{
                  bottom: `${(t / maxYen) * 100}%`,
                  borderTop: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)',
                }}
              />
            ))}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{ borderTop: '1px solid color-mix(in srgb, var(--ink) 22%, transparent)' }}
            />

            {isCum ? (
              <CumulativeLayer
                chart={cumulative}
                x={x}
                y={y}
                n={n}
                color={lineColor}
                dim={tip !== null}
              />
            ) : (
              <>
                {series.allowanceYen !== null ? (
                  <Line
                    kind="allowance"
                    ratio={barRatio(series.allowanceYen, maxYen)}
                    dim={tip !== null}
                  />
                ) : null}
                {series.averageLineYen !== null ? (
                  <Line
                    kind="average"
                    ratio={barRatio(series.averageLineYen, maxYen)}
                    dim={tip !== null}
                  />
                ) : null}
                {Array.from({ length: MAX_BARS }, (_, i) => {
                  const b = i < n ? series.buckets[i] : undefined;
                  const slot = 100 / Math.max(n, 1);
                  const center = b ? i * slot + slot / 2 : 100;
                  const width = b ? slot * (1 - GAP) : 0;
                  const actualYen = b ? Math.max(b.actualYen, 0) : 0;
                  const allowance = series.allowanceYen;
                  const over = b && allowance !== null ? Math.max(actualYen - allowance, 0) : 0;
                  const baseYen = actualYen - over;
                  const base = barRatio(baseYen, maxYen);
                  const overR = barRatio(over, maxYen);
                  const sched = b ? barRatio(b.scheduledYen, maxYen) : 0;
                  const prev =
                    b && showPrevious && series.hasPrevious && b.previousYen !== null
                      ? barRatio(b.previousYen, maxYen)
                      : 0;
                  const common = {
                    left: `${center}%`,
                    width: `${width}%`,
                    maxWidth: BAR_MAX_PX,
                    transform: 'translateX(-50%)',
                  } as const;
                  const dimmed = tip !== null && tip !== i ? 0.5 : 1;
                  const topRadius = `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0`;
                  return (
                    <div key={i} aria-hidden>
                      <div
                        className="chart-bar absolute bottom-0"
                        style={{
                          ...common,
                          height: `${prev * 100}%`,
                          background: 'color-mix(in srgb, var(--ink) 12%, transparent)',
                          borderRadius: topRadius,
                        }}
                      />
                      <div
                        className="chart-bar absolute bottom-0"
                        style={{
                          ...common,
                          height: `${base * 100}%`,
                          background: barColor,
                          borderRadius: over > 0 ? 0 : topRadius,
                          outline: selectedIndex === i ? '2px solid var(--ink)' : 'none',
                          outlineOffset: 1,
                          opacity: dimmed,
                        }}
                      />
                      <div
                        data-over-allowance={over > 0 ? '' : undefined}
                        className="chart-bar absolute"
                        style={{
                          ...common,
                          bottom: `${base * 100}%`,
                          height: `${overR * 100}%`,
                          background: 'var(--state-caution)',
                          borderRadius: sched > 0 ? 0 : topRadius,
                          opacity: dimmed,
                        }}
                      />
                      <div
                        className="chart-bar absolute"
                        style={{
                          ...common,
                          bottom: `${(base + overR) * 100}%`,
                          height: `${sched * 100}%`,
                          background: `repeating-linear-gradient(45deg, ${barColor} 0 3px, transparent 3px 6px)`,
                          borderRadius: topRadius,
                          opacity: 0.7 * dimmed,
                        }}
                      />
                    </div>
                  );
                })}
              </>
            )}

            {tip !== null && n > 0 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `${x(tip)}%`,
                  borderLeft: '1px solid color-mix(in srgb, var(--ink) 45%, transparent)',
                }}
              />
            ) : null}

            {/* 累計:線の先端の点と「理想より○円少ない / 多い」 */}
            {isCum && end && end.actualYen !== null ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute size-2 rounded-full"
                  style={{
                    left: `${x(end.index)}%`,
                    bottom: `${100 - y(end.actualYen)}%`,
                    transform: 'translate(-50%, 50%)',
                    background: lineColor,
                    boxShadow: '0 0 0 2px var(--surface)',
                  }}
                />
                {cumulative.deltaYen !== null && deltaGeometry && !bigText ? (
                  <DeltaLabel
                    text={idealDeltaLabel(cumulative.deltaYen)}
                    geometry={deltaGeometry}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          {/* 右端の余白:金額の目盛りと、目安・平均のタグ(描画領域の外に置き、重ならないよう配置) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{ width: GUTTER_W, opacity: tip !== null ? 0.6 : 1 }}
          >
            {placed.map((p) => (
              <span
                key={p.key}
                data-chart-label="gutter"
                className="tabular absolute right-0 pl-2 text-right text-xs leading-tight"
                style={{
                  top: p.centerPx,
                  transform: 'translateY(-50%)',
                  color: p.kind === 'tag' ? 'var(--ink)' : 'var(--ink-secondary)',
                  fontWeight: p.kind === 'tag' ? 600 : 400,
                }}
              >
                {p.kind === 'tag' ? (
                  <>
                    <span className="block">{p.key === 'allowance' ? '目安' : '平均'}</span>
                    <span className="block">
                      {formatAxisYen(
                        (p.key === 'allowance' ? series.allowanceYen : series.averageLineYen)!,
                      )}
                    </span>
                  </>
                ) : (
                  formatAxisYen(Number(p.key.slice(5)))
                )}
              </span>
            ))}
          </div>
        </div>

        {/* 横軸のラベル(最大5個・折り返さない) */}
        <div
          aria-hidden
          className="tabular relative mt-1 h-4 text-xs"
          style={{ color: 'var(--ink-secondary)', marginRight: GUTTER_W }}
        >
          {axis.map((a) => (
            <span
              key={a.index}
              data-chart-label="axis"
              className="absolute whitespace-nowrap"
              style={
                a.index === 0
                  ? { left: 0 }
                  : a.index === n - 1
                    ? { right: 0 }
                    : { left: `${x(a.index)}%`, transform: 'translateX(-50%)' }
              }
            >
              {a.text}
            </span>
          ))}
        </div>

        {/* 平均と目安の中身(対象期間つき)。線のラベルはグラフの右の余白のタグ */}
        {!isCum && (series.averageYen !== null || series.allowanceYen !== null) ? (
          <dl className="mt-2 space-y-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {series.averageYen !== null ? (
              <div className="flex gap-2">
                <dt>1日平均({md(series.averageFrom ?? series.recordStart)}〜)</dt>
                <dd className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
                  {series.averageYen.toLocaleString('ja-JP')}円
                </dd>
              </div>
            ) : null}
            {series.allowanceYen !== null && series.unit === 'day' ? (
              <div className="flex gap-2">
                <dt>1日の目安(このカテゴリ)</dt>
                <dd className="tabular font-semibold" style={{ color: 'var(--ink)' }}>
                  {series.allowanceYen.toLocaleString('ja-JP')}円
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {/* VoiceOver・キーボード向け:区間ごとのボタン(金額・件数)。見た目は隠す */}
        <ul className="sr-only">
          {series.buckets.map((b) => (
            <li key={b.from}>
              <button type="button" className="min-h-11" onClick={() => !b.future && onPick(b)}>
                {bucketTooltip(b, series.unit)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {isCum
            ? '実線=実績の累計、点線=予算までの理想。軸は予算'
            : '長押ししてなぞると、日ごとの金額が見られます'}
        </p>
        <button
          type="button"
          onClick={playAudio}
          className="min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold whitespace-nowrap"
          style={{ color: 'var(--ink-secondary)' }}
        >
          音で聞く
        </button>
      </div>
      {audioNote ? (
        <p role="status" className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {audioNote}
        </p>
      ) : null}
    </section>
  );
}

/** 累計の線・理想ペース・予測の帯・予定の段差。 */
function CumulativeLayer({
  chart,
  x,
  y,
  n,
  color,
  dim,
}: {
  chart: CumulativeChart;
  x: (i: number) => number;
  y: (v: number) => number;
  n: number;
  color: string;
  dim: boolean;
}) {
  const actual = chart.days.filter((d) => d.actualYen !== null);
  const ideal = chart.days.filter((d) => d.idealYen !== null);
  const fut = chart.days.filter((d) => d.forecastHighYen !== null);
  const end = chart.endIndex !== null ? chart.days[chart.endIndex]! : null;
  const pts = (list: { index: number; v: number }[]) =>
    list.map((p) => `${x(p.index).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
  const band =
    end && end.actualYen !== null && fut.length > 0
      ? [
          `${x(end.index).toFixed(2)},${y(end.actualYen).toFixed(2)}`,
          ...fut.map((d) => `${x(d.index).toFixed(2)},${y(d.forecastHighYen!).toFixed(2)}`),
          ...[...fut]
            .reverse()
            .map((d) => `${x(d.index).toFixed(2)},${y(d.forecastLowYen!).toFixed(2)}`),
        ].join(' ')
      : null;
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {band ? (
          <polygon points={band} fill={color} fillOpacity={dim ? 0.07 : 0.14} data-forecast-band />
        ) : null}
        {ideal.length > 1 ? (
          <polyline
            data-ideal
            points={pts(ideal.map((d) => ({ index: d.index, v: d.idealYen! })))}
            fill="none"
            stroke="var(--ink-secondary)"
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={dim ? 0.5 : 1}
          />
        ) : null}
        {end && end.actualYen !== null && fut.length > 0 ? (
          <polyline
            points={pts([
              { index: end.index, v: end.actualYen },
              ...fut.map((d) => ({ index: d.index, v: d.forecastYen! })),
            ])}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />
        ) : null}
        {actual.length > 0 ? (
          <polyline
            data-actual
            points={pts(actual.map((d) => ({ index: d.index, v: d.actualYen! })))}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {/* 予定の支出:その日の白抜きの段差 */}
      {fut
        .filter((d) => d.scheduledYen > 0)
        .map((d) => (
          <span
            key={d.date}
            data-scheduled-step
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: `${x(d.index)}%`,
              width: Math.min(10, (100 / Math.max(n, 1)) * 0.7 * 3),
              bottom: `${100 - y(d.forecastYen!)}%`,
              height: `${Math.max(y(d.forecastYen! - d.scheduledYen) - y(d.forecastYen!), 0)}%`,
              minHeight: 3,
              transform: 'translateX(-50%)',
              background: 'var(--surface)',
              border: `1.5px solid ${color}`,
              borderRadius: 2,
            }}
          />
        ))}
    </>
  );
}

/**
 * 目安(破線・濃い)と平均(点線・薄い)の水平線。線の種類と濃さを変えて見分けられるようにする。
 * ラベルは右の余白のタグ(描画領域の外)に出すので、データとは重ならない。
 */
function Line({
  kind,
  ratio,
  dim,
}: {
  kind: 'allowance' | 'average';
  ratio: number;
  dim: boolean;
}) {
  const allowance = kind === 'allowance';
  return (
    <div
      aria-hidden
      data-line={kind}
      className="pointer-events-none absolute inset-x-0"
      style={{
        bottom: `${ratio * 100}%`,
        borderTop: allowance
          ? '1.5px dashed var(--ink-secondary)'
          : '1.5px dotted color-mix(in srgb, var(--ink) 40%, transparent)',
        opacity: dim ? 0.5 : 1,
      }}
    />
  );
}
