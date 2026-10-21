'use client';

import { useMemo, useState } from 'react';

import { probabilityAt, type ForecastDistribution } from '@/domain/forecast/distribution';
import { presentationRange, smoothDistribution } from '@/domain/forecast/distribution-presentation';
import { formatEstimate, formatProbability } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';

/** 軸の金額「16.9万」。選択した金額は丸めず、確率の閾値と一致させる。 */
function man(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/** 拡大しても、確率は範囲外を含む同じ分布から出す(ADR-123)。 */
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
  const [mode, setMode] = useState<'focus' | 'full'>('focus');
  const { min, max, singleAmount, canFocus } = presentationRange(distribution, mode);
  const curve = useMemo(
    () => smoothDistribution(distribution, { min, max, anchors: [budgetYen], bins: 18 }),
    [distribution, min, max, budgetYen],
  );
  const W = 326;
  const H = 126;
  const left = 3;
  const right = 323;
  const base = 104;
  const clamp = (yen: number) => Math.min(max, Math.max(min, Math.round(yen)));
  const xOf = (yen: number) => left + ((yen - min) / (max - min)) * (right - left);
  const yenOf = (x: number) => min + ((x - left) / (right - left)) * (max - min);
  const yOf = (density: number) => base - (density / Math.max(curve.peakDensity, 1e-12)) * 88;
  const segments = curve.segments.map((segment) => ({
    ...segment,
    startX: xOf(segment.from),
    endX: xOf(segment.to),
    startY: yOf(segment.startDensity),
    controlY: yOf(segment.controlDensity),
    endY: yOf(segment.endDensity),
  }));
  const outline = segments
    .map(
      (segment, i) =>
        `${i === 0 ? `M${segment.startX},${segment.startY} ` : ''}Q${(segment.startX + segment.endX) / 2},${segment.controlY} ${segment.endX},${segment.endY}`,
    )
    .join(' ');
  const largestAtom = curve.atoms.reduce<(typeof curve.atoms)[number] | null>(
    (largest, atom) => (!largest || atom.probability > largest.probability ? atom : largest),
    null,
  );
  const probWithin = probabilityAt(distribution, budgetYen);
  const caution = probWithin < 0.5;
  const tapProb = selected === null ? null : probabilityAt(distribution, selected);
  const sliderYen = clamp(selected ?? budgetYen);
  const outside = (yen: number) => (yen < min ? 'left' : yen > max ? 'right' : null);
  const goalOutside = outside(budgetYen);
  const selectedOutside = selected === null ? null : outside(selected);
  const edgeArrow = (side: 'left' | 'right' | null) =>
    side === 'left' ? '← ' : side === 'right' ? '→ ' : '';
  const hasHiddenTails = curve.leftProbability > 0 || curve.rightProbability > 0;
  const hiddenTails = [
    curve.leftProbability > 0 ? `低い側${formatProbability(curve.leftProbability)}` : null,
    curve.rightProbability > 0 ? `高い側${formatProbability(curve.rightProbability)}` : null,
  ]
    .filter(Boolean)
    .join('・');
  const selectionText =
    selected !== null && tapProb !== null
      ? `${formatYen(selected)}以下になる確率 ${formatProbability(tapProb)}${selectedOutside ? '（表示範囲外）' : ''}`
      : null;
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || !Number.isFinite(clientX)) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    setSelected(clamp(yenOf(Math.min(right, Math.max(left, x)))));
  };

  return (
    <section
      aria-labelledby="forecast-prob"
      className="flex flex-col rounded-2xl px-4 pt-5 pb-4"
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
      {canFocus ? (
        <div
          role="group"
          aria-label="グラフの表示範囲"
          className="mt-3 flex self-end rounded-full p-1"
          style={{ background: 'var(--bg)' }}
        >
          {(
            [
              ['focus', '主な範囲'],
              ['full', '全体'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className="min-h-11 rounded-full px-4 text-[13px] font-semibold"
              style={{
                background: mode === value ? 'var(--surface)' : 'transparent',
                color: mode === value ? 'var(--ink)' : 'var(--ink-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`着地額の分布。見込みの中央${man(p50)}円、目標${formatYen(budgetYen)}以下になるのは${formatProbability(probWithin)}。${hasHiddenTails ? '主な金額帯を拡大。表示範囲外も確率に含みます。' : '色のついた部分が目標内の見込み。'}`}
        className="mt-3 cursor-pointer select-none"
        style={{ touchAction: 'none' }}
        data-left-probability={curve.leftProbability}
        data-right-probability={curve.rightProbability}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pick(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0) pick(e.clientX, e.currentTarget);
        }}
      >
        {singleAmount === null ? (
          <>
            {segments.map((segment) => (
              <path
                key={segment.from}
                d={`M${segment.startX},${base} L${segment.startX},${segment.startY} Q${(segment.startX + segment.endX) / 2},${segment.controlY} ${segment.endX},${segment.endY} L${segment.endX},${base} Z`}
                fill={segment.to <= budgetYen ? 'var(--accent)' : 'var(--ink)'}
                opacity={segment.to <= budgetYen ? 0.3 : 0.08}
              />
            ))}
            <path d={outline} fill="none" stroke="var(--ink)" strokeWidth="1.8" />
            {curve.atoms.map((atom) => {
              const x = xOf(atom.yen);
              const y = base - atom.probability * 88;
              const color = atom.yen <= budgetYen ? 'var(--accent)' : 'var(--ink)';
              return (
                <g key={atom.yen}>
                  <line
                    x1={x}
                    y1={y}
                    x2={x}
                    y2={base}
                    stroke={color}
                    strokeWidth="2.5"
                    data-atom-probability={atom.probability}
                  />
                  <circle cx={x} cy={y} r={atom.probability >= 0.02 ? 3 : 1.5} fill={color} />
                </g>
              );
            })}
          </>
        ) : (
          <line
            x1={xOf(singleAmount)}
            y1="16"
            x2={xOf(singleAmount)}
            y2={base}
            stroke="var(--ink)"
            strokeWidth="3"
            data-single-amount={singleAmount}
          />
        )}
        {goalOutside === null ? (
          <line
            x1={xOf(budgetYen)}
            y1="8"
            x2={xOf(budgetYen)}
            y2={base}
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
        ) : (
          <text
            x={goalOutside === 'left' ? left : right}
            y="13"
            fontSize="11"
            textAnchor={goalOutside === 'left' ? 'start' : 'end'}
            fill="var(--accent)"
          >
            {goalOutside === 'left' ? '← 目標' : '目標 →'}
          </text>
        )}
        {outside(p50) === null ? (
          <line
            x1={xOf(p50)}
            y1="16"
            x2={xOf(p50)}
            y2={base}
            stroke="var(--ink-muted)"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        ) : null}
        <line x1={left} y1={base} x2={right} y2={base} stroke="var(--bar-quiet)" />
        {selected !== null && selectedOutside === null ? (
          <line
            x1={xOf(selected)}
            y1="8"
            x2={xOf(selected)}
            y2={base}
            stroke="var(--ink)"
            strokeWidth="1.5"
          />
        ) : null}
        <text x={left} y="122" fontSize="11" fill="var(--ink-muted)">
          {man(min)}
        </text>
        <text x={right} y="122" fontSize="11" fill="var(--ink-muted)" textAnchor="end">
          {man(max)}
        </text>
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span className="h-3 w-0.5" style={{ background: 'var(--accent)' }} />
            目標
          </div>
          <p className="tabular mt-1 text-[17px] font-semibold">
            {edgeArrow(goalOutside)}
            {formatEstimate(budgetYen, { approx: false })}
          </p>
        </div>
        <div>
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span
              className="h-3 border-l border-dashed"
              style={{ borderColor: 'var(--ink-muted)' }}
            />
            見込み（中央）
          </div>
          <p className="tabular mt-1 text-[17px] font-semibold">
            {formatEstimate(p50, { approx: false })}
          </p>
        </div>
      </div>
      {singleAmount !== null ? (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          見込みは{formatYen(singleAmount)}に集中しています。
        </p>
      ) : null}
      {singleAmount === null && largestAtom !== null && largestAtom.probability >= 0.02 ? (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {formatYen(largestAtom.yen)}に{formatProbability(largestAtom.probability)}
          の予測が集中しています。
        </p>
      ) : null}
      {hasHiddenTails ? (
        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          表示外：{hiddenTails}。範囲外も確率に含みます。
        </p>
      ) : null}
      {goalOutside ? (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          目標は表示範囲より{goalOutside === 'left' ? '左' : '右'}にあります。
        </p>
      ) : null}
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
        role={selected !== null ? 'status' : undefined}
        className="tabular mt-1 text-[13px]"
        style={{ color: selected !== null ? 'var(--ink)' : 'var(--ink-muted)' }}
      >
        {selectionText
          ? `${edgeArrow(selectedOutside)}${selectionText}`
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
