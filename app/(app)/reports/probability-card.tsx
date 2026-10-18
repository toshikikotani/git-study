'use client';

import { useState } from 'react';

import {
  histogram,
  probabilityAt,
  type ForecastDistribution,
} from '@/domain/forecast/distribution';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';

/** グラフの金額「16.9万」。選択した金額は丸めず、確率の閾値と一致させる。 */
function man(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/** 見出し・棒の面積・選択した金額の確率を、同じ試行と補正から出す(ADR-122)。 */
export function ProbabilityCard({
  distribution,
  p50,
  budgetYen,
  provisional = false,
}: {
  distribution: ForecastDistribution;
  p50: number;
  budgetYen: number;
  provisional?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const W = 326;
  const H = 92;
  const left = 3;
  const right = 323;
  const base = 74;
  const first = distribution.amounts[0] ?? budgetYen;
  const last = distribution.amounts.at(-1) ?? budgetYen;
  // 端の試行も棒に含める。全試行が同額でも描画幅を確保する。
  const padding = first === last ? Math.max(1, Math.round(Math.abs(first) * 0.02)) : 1;
  const min = Math.min(first, budgetYen) - padding;
  const max = Math.max(last, budgetYen) + padding;
  const clamp = (yen: number) => Math.min(max, Math.max(min, Math.round(yen)));
  const xOf = (yen: number) => left + ((yen - min) / (max - min)) * (right - left);
  const yenOf = (x: number) => min + ((x - left) / (right - left)) * (max - min);
  const bins = histogram(distribution, { min, max, bins: 32, threshold: budgetYen });
  const peak = Math.max(...bins.map((bin) => bin.probability / (bin.to - bin.from)), 1e-12);
  const bars = bins.map((bin) => ({
    ...bin,
    x: xOf(bin.from),
    width: xOf(bin.to) - xOf(bin.from),
    height: (bin.probability / (bin.to - bin.from) / peak) * (base - 8),
  }));
  const outline = bars
    .map(
      (bar, i) =>
        `${i === 0 ? 'M' : 'L'}${bar.x},${base - bar.height} L${bar.x + bar.width},${base - bar.height}`,
    )
    .join(' ');
  const probWithin = probabilityAt(distribution, budgetYen);
  const caution = probWithin < 0.5;
  const tapYen = selected === null ? null : clamp(selected);
  const tapProb = tapYen === null ? null : probabilityAt(distribution, tapYen);
  const sliderYen = tapYen ?? clamp(budgetYen);
  const bx = xOf(budgetYen);
  const midX = xOf(p50);
  const midNearBudget = Math.abs(midX - bx) < 64;
  const anchor = (x: number) => (x < left + 56 ? 'start' : x > right - 56 ? 'end' : 'middle');
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || !Number.isFinite(clientX)) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    setSelected(clamp(yenOf(Math.min(right, Math.max(left, x)))));
  };

  return (
    <section
      aria-labelledby="forecast-prob"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="forecast-prob" className="text-[17px] font-semibold">
          目標内に収まる確率
        </h2>
        <span
          className="tabular text-[28px] font-bold"
          style={{ color: caution ? 'var(--state-caution)' : 'var(--income)' }}
        >
          {formatProbability(probWithin)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`着地額の分布。中央${man(p50)}円、目標${formatYen(budgetYen)}以下になるのは${formatProbability(probWithin)}。色のついた部分が目標内の見込み。`}
        className="mt-2 cursor-pointer select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pick(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0) pick(e.clientX, e.currentTarget);
        }}
      >
        {bars.map((bar) => (
          <rect
            key={bar.from}
            x={bar.x}
            y={base - bar.height}
            width={bar.width}
            height={bar.height}
            fill={bar.to <= budgetYen ? 'var(--accent)' : 'var(--ink)'}
            opacity={bar.to <= budgetYen ? 0.35 : 0.08}
          />
        ))}
        <path d={outline} fill="none" stroke="var(--ink)" strokeWidth="1.6" />
        <line
          x1={bx}
          y1="4"
          x2={bx}
          y2={base}
          stroke="var(--ink)"
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
        <line x1={left} y1={base} x2={right} y2={base} stroke="var(--bar-quiet)" />
        {tapYen !== null ? (
          <line
            x1={xOf(tapYen)}
            y1="4"
            x2={xOf(tapYen)}
            y2={base}
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
        ) : null}
        <text
          x={bx}
          y="88"
          fontSize="11"
          fill="var(--ink)"
          textAnchor={anchor(bx)}
          fontWeight="600"
        >
          目標 {man(budgetYen)}
        </text>
        {!midNearBudget ? (
          <text x={midX} y="88" fontSize="11" fill="var(--ink-muted)" textAnchor={anchor(midX)}>
            中央 {man(p50)}
          </text>
        ) : null}
        {bx - left > 56 && midX - left > 56 ? (
          <text x={left} y="88" fontSize="11" fill="var(--ink-muted)">
            {man(first >= 0 ? Math.max(0, min) : min)}
          </text>
        ) : null}
        {right - bx > 56 && right - midX > 56 ? (
          <text x={right} y="88" fontSize="11" fill="var(--ink-muted)" textAnchor="end">
            {man(max)}
          </text>
        ) : null}
      </svg>
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        value={sliderYen}
        aria-label="確率を調べる金額"
        aria-valuetext={`${formatYen(sliderYen)}以下になる確率 ${formatProbability(probabilityAt(distribution, sliderYen))}`}
        className="mt-3 h-6 w-full"
        style={{ accentColor: 'var(--accent)' }}
        onChange={(e) => {
          const yen = Number(e.target.value);
          if (Number.isFinite(yen)) setSelected(clamp(yen));
        }}
      />
      <span
        role={tapYen !== null ? 'status' : undefined}
        className="tabular mt-1 text-[13px]"
        style={{ color: tapYen !== null ? 'var(--ink)' : 'var(--ink-muted)' }}
      >
        {tapYen !== null && tapProb !== null
          ? `${formatYen(tapYen)}以下になる確率 ${formatProbability(tapProb)}`
          : 'グラフをタップするか、つまみで金額を選べます。'}
      </span>
      {provisional ? (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          記録が少ないため、確率は目安です。
        </p>
      ) : null}
    </section>
  );
}
