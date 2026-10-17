'use client';

import { useState } from 'react';

import { formatEstimate, formatProbability } from '@/domain/forecast/format';

/** グラフの金額「16.9万」。 */
function man(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/** 正規分布の累積(Abramowitz–Stegun の近似)。 */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/**
 * 目標内に収まる確率(デザイン仕様書の「見通し」、ADR-090):大きな確率と、着地額の分布。予算より左を塗る。
 * グラフをタップすると、その金額以下になる確率を出す(予算の近くは試行の結果そのものを出す)。
 */
export function ProbabilityCard({
  p10,
  p50,
  p90,
  budgetYen,
  probWithin,
}: {
  p10: number;
  p50: number;
  p90: number;
  budgetYen: number;
  probWithin: number;
}) {
  const [tap, setTap] = useState<number | null>(null);
  const W = 326;
  const H = 92;
  const left = 3;
  const right = 323;
  const base = 74;
  const sigma = Math.max(1, (p90 - p10) / 2.563);
  const min = Math.min(p50 - 3 * sigma, budgetYen - sigma);
  const max = Math.max(p50 + 3 * sigma, budgetYen + sigma);
  const xOf = (yen: number) => left + ((yen - min) / (max - min)) * (right - left);
  const yenOf = (x: number) => min + ((x - left) / (right - left)) * (max - min);
  const yOf = (yen: number) => {
    const z = (yen - p50) / sigma;
    return base - Math.exp(-0.5 * z * z) * (base - 8);
  };
  const steps = 56;
  const curve = Array.from({ length: steps + 1 }, (_, i) => {
    const yen = min + ((max - min) * i) / steps;
    return { x: xOf(yen), y: yOf(yen), yen };
  });
  const line = `M${curve.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  const bx = Math.min(right, Math.max(left, xOf(budgetYen)));
  const under = curve.filter((p) => p.yen <= budgetYen);
  const fill =
    under.length > 0
      ? `M${left},${base} L${under.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} L${bx.toFixed(1)},${yOf(budgetYen).toFixed(1)} L${bx.toFixed(1)},${base} Z`
      : null;
  const caution = probWithin < 0.5;
  const tapYen = tap === null ? null : yenOf(tap);
  const tapProb =
    tapYen === null
      ? null
      : Math.abs(tapYen - budgetYen) < (p90 - p10) * 0.04
        ? probWithin
        : normalCdf((tapYen - p50) / sigma);

  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    setTap(Math.min(right, Math.max(left, x)));
  };
  const midX = xOf(p50);
  const midNearBudget = Math.abs(midX - bx) < 64;

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
        aria-label={`着地額の分布。中央${man(p50)}円、目標${man(budgetYen)}円以下になるのは${formatProbability(probWithin)}`}
        className="mt-2 cursor-pointer select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pick(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0) pick(e.clientX, e.currentTarget);
        }}
      >
        {fill ? <path d={fill} fill="var(--accent)" opacity="0.28" /> : null}
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.6" />
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
        {tap !== null ? (
          <line x1={tap} y1="4" x2={tap} y2={base} stroke="var(--accent)" strokeWidth="1.5" />
        ) : null}
        <text x={bx} y="88" fontSize="11" fill="var(--ink)" textAnchor="middle" fontWeight="600">
          目標 {man(budgetYen)}
        </text>
        {!midNearBudget ? (
          <text x={midX} y="88" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
            中央 {man(p50)}
          </text>
        ) : null}
        {bx - left > 56 ? (
          <text x={left} y="88" fontSize="11" fill="var(--ink-muted)">
            {man(min)}
          </text>
        ) : null}
        {right - bx > 56 && Math.abs(right - midX) > 56 ? (
          <text x={right} y="88" fontSize="11" fill="var(--ink-muted)" textAnchor="end">
            {man(max)}
          </text>
        ) : null}
      </svg>
      <span
        role={tapYen !== null ? 'status' : undefined}
        className="tabular mt-2 text-[13px]"
        style={{ color: tapYen !== null ? 'var(--ink)' : 'var(--ink-muted)' }}
      >
        {tapYen !== null && tapProb !== null
          ? `${man(tapYen)}円以下になる確率 ${formatProbability(tapProb)}`
          : 'グラフをタップすると、その金額以下になる確率を表示します。'}
      </span>
    </section>
  );
}
