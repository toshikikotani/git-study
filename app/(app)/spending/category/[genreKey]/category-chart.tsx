'use client';

import { useEffect, useRef, useState } from 'react';

import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { genreBarColor } from '@/domain/genre-style';
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
import { hapticFor } from '@/lib/haptics';
import { ChartGesture } from '@/lib/chart-gesture';

const PLOT_HEIGHT = 168;
const GAP = 0.18; // 棒の間の隙間(区間の幅に対する割合)

/**
 * 触って読めるグラフ。日 / 週 / 月 を切り替えられ(棒は滑らかに変形する)、前期間の実績を
 * 薄い影の棒で重ね(オン/オフ可)、期間の平均を点線で、目標期間中は1日の目安を線で見せる。
 * 長押しして指でなぞると、なぞっている区間の日付・金額・件数を吹き出しで見せ、1つ進むごとに
 * 選択の触覚を返す。棒をタップするとその区間に絞り込む。予定は斜線の棒+カレンダーのマーク。
 *
 * 棒は31本ぶんの部品を使い回す(単位を切り替えると、本数・位置・高さが CSS の transition で
 * 変形する)。なぞる操作では、区間が変わったときだけ再描画する(1フレーム16ms以内)。
 * 読み上げ:グラフの要約(最大・合計・平均)と、区間ごとのボタン(金額・件数)を用意する。
 */
export function CategoryChart({
  series,
  genreName,
  monthLabel,
  showPrevious,
  onShowPrevious,
  onUnit,
  onPick,
  selectedIndex,
}: {
  series: Series;
  genreName: string;
  monthLabel: string;
  showPrevious: boolean;
  onShowPrevious: (on: boolean) => void;
  onUnit: (unit: ChartUnit) => void;
  onPick: (bucket: Bucket) => void;
  selectedIndex: number | null;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<number | null>(null);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const n = series.buckets.length;
  const overrides = useGenreOverrides();
  const color = genreBarColor(
    genreName === '未分類' ? null : genreName,
    genreName === '未分類' ? null : overrides[genreName],
  );

  // なぞり操作(長押し・なぞる・タップ)の状態機械。DOM に触れない(lib/chart-gesture.ts)。
  const [gesture] = useState(() => new ChartGesture());
  useEffect(() => {
    gesture.configure({
      bucketCount: n,
      geometry: () => {
        const r = plot.current?.getBoundingClientRect();
        return { left: r?.left ?? 0, width: r?.width ?? 1 };
      },
      pickable: (i) => series.buckets[i] !== undefined && !series.buckets[i]!.future,
      onTip: setTip,
      onHaptic: () => hapticFor('chartScrub'),
      onPick: (i) => onPick(series.buckets[i]!),
    });
  }, [gesture, n, series, onPick]);

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

  const summary = summarizeSeries(series, genreName, monthLabel);
  const tipBucket = tip !== null ? series.buckets[tip] : null;

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
    const plan = audioGraphPlan(series.buckets.map((b) => b.actualYen));
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

  return (
    <section
      aria-label="グラフ"
      className="space-y-3 rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="グラフの単位" className="flex gap-1">
          {CHART_UNITS.map((u) => (
            <button
              key={u.value}
              type="button"
              role="tab"
              aria-selected={series.unit === u.value}
              onClick={() => {
                if (series.unit !== u.value) hapticFor('tabChange');
                onUnit(u.value);
              }}
              className="min-h-11 min-w-11 rounded-full px-4 text-sm font-semibold"
              style={{
                background: series.unit === u.value ? 'var(--accent)' : 'transparent',
                color: series.unit === u.value ? 'var(--on-accent)' : 'var(--ink-secondary)',
                border: `1px solid ${series.unit === u.value ? 'transparent' : 'var(--hairline)'}`,
              }}
            >
              {u.label}
            </button>
          ))}
        </div>
        <label
          className="flex min-h-11 items-center gap-2 text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <input
            type="checkbox"
            checked={showPrevious}
            onChange={(e) => onShowPrevious(e.target.checked)}
            className="size-5"
          />
          前期間を重ねる
        </label>
      </div>

      <div role="group" aria-label={summary}>
        <div
          ref={plot}
          className="relative w-full touch-pan-y select-none"
          style={{ height: PLOT_HEIGHT }}
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
          {/* 平均(点線)と1日の目安(線) */}
          {series.averageYen !== null ? (
            <Line
              ratio={barRatio(series.averageYen, series.maxYen)}
              dashed
              label={`平均 ${series.averageYen.toLocaleString('ja-JP')}円`}
            />
          ) : null}
          {series.allowanceYen !== null ? (
            <Line
              ratio={barRatio(series.allowanceYen, series.maxYen)}
              label={`目安 ${series.allowanceYen.toLocaleString('ja-JP')}円`}
              below
            />
          ) : null}

          {Array.from({ length: MAX_BARS }, (_, i) => {
            const b = i < n ? series.buckets[i] : undefined;
            const slot = 100 / Math.max(n, 1);
            const left = b ? i * slot + (slot * GAP) / 2 : 100;
            const width = b ? slot * (1 - GAP) : 0;
            const actual = b ? barRatio(b.actualYen, series.maxYen) : 0;
            const sched = b ? barRatio(b.scheduledYen, series.maxYen) : 0;
            const prev =
              b && showPrevious && b.previousYen !== null
                ? barRatio(b.previousYen, series.maxYen)
                : 0;
            return (
              <div key={i} aria-hidden>
                {/* 前期間の実績(薄い影の棒) */}
                <div
                  className="chart-bar absolute bottom-0"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${prev * 100}%`,
                    background: 'color-mix(in srgb, var(--ink) 12%, transparent)',
                    borderRadius: 'var(--radius-inner) var(--radius-inner) 0 0',
                  }}
                />
                {/* 実績 */}
                <div
                  className="chart-bar absolute bottom-0"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${actual * 100}%`,
                    background: color,
                    borderRadius: '6px 6px 0 0',
                    outline: selectedIndex === i ? '2px solid var(--ink)' : 'none',
                    outlineOffset: 1,
                    opacity: tip !== null && tip !== i ? 0.55 : 1,
                  }}
                />
                {/* 予定(斜線。実績と区別する) */}
                <div
                  className="chart-bar absolute"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    bottom: `${actual * 100}%`,
                    height: `${sched * 100}%`,
                    background: `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)`,
                    borderRadius: '6px 6px 0 0',
                    opacity: 0.7,
                  }}
                />
                {/* 予定がある日:小さなカレンダーのマーク */}
                {b && b.scheduledYen > 0 ? (
                  <svg
                    data-scheduled-mark
                    viewBox="0 0 12 12"
                    className="absolute size-3"
                    style={{
                      left: `calc(${left + width / 2}% - 6px)`,
                      bottom: `calc(${(actual + sched) * 100}% + 2px)`,
                    }}
                    fill="none"
                    stroke="var(--ink-secondary)"
                    strokeWidth="1.2"
                  >
                    <rect x="1.5" y="2.5" width="9" height="8" rx="1.5" />
                    <path d="M1.5 5h9M4 1.5v2M8 1.5v2" />
                  </svg>
                ) : null}
              </div>
            );
          })}

          {tipBucket ? (
            <div
              role="status"
              className="tabular pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap"
              style={{
                left: `clamp(0px, calc(${((tip! + 0.5) / n) * 100}% - 70px), calc(100% - 140px))`,
                background: 'var(--ink)',
                color: 'var(--surface)',
              }}
            >
              {bucketTooltip(tipBucket, series.unit)}
            </div>
          ) : null}
        </div>

        {/* 軸のラベル(日は一部だけ) */}
        <div
          aria-hidden
          className="tabular relative mt-1 h-4 text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {series.buckets.map((b, i) =>
            series.unit === 'day' && i % 7 !== 0 ? null : (
              <span
                key={b.from}
                className="absolute"
                style={{ left: `${(i / Math.max(n, 1)) * 100}%` }}
              >
                {b.label}
              </span>
            ),
          )}
        </div>

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
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          長押ししてなぞると、日ごとの金額が見られます
        </p>
        <button
          type="button"
          onClick={playAudio}
          className="min-h-11 rounded-full px-3 text-xs font-semibold"
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

function Line({
  ratio,
  label,
  dashed = false,
  below = false,
}: {
  ratio: number;
  label: string;
  dashed?: boolean;
  below?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0"
      style={{
        bottom: `${ratio * 100}%`,
        borderTop: `1px ${dashed ? 'dotted' : 'solid'} var(--ink-secondary)`,
      }}
    >
      <span
        className="tabular absolute right-0 px-1 text-xs"
        style={{
          [below ? 'top' : 'bottom']: 1,
          color: 'var(--ink-secondary)',
          background: 'var(--surface)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
