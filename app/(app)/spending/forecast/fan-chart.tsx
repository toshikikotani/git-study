'use client';

/**
 * 扇形のグラフ(M6):累計の実績(実線)の先に、中央(点線)と10回中8回・5回の幅
 * (淡い帯)を描き、予算の線を重ねる。打ち手のチップを押すと、その打ち手を
 * 反映した見込みに切り替わる(押し直すと元に戻る)。
 */

import { useState } from 'react';

import { fanAt } from '@/domain/forecast/fan';
import { approxYen, outOfTen } from '@/domain/forecast/format';

export type FanScenario = {
  id: string;
  /** チップの文言(「外食を週1回へらす」)。 */
  label: string;
  landing: { p10: number; p50: number; p90: number };
  probWithinBudget: number | null;
};

const W = 326;
const H = 226;
const LEFT = 8;
const RIGHT = 268;
const TOP = 14;
const BOTTOM = 200;

function niceCeil(v: number): number {
  if (v <= 0) return 10_000;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

export function FanChart({
  days,
  todayIndex,
  actualCumulative,
  baseline,
  scenarios,
  budgetYen,
}: {
  /** 期間の各日の表示ラベル(「10/1」)。 */
  days: readonly string[];
  /** 今日が days の何番目か(0始まり)。 */
  todayIndex: number;
  /** 期間の初日から今日までの累計。 */
  actualCumulative: readonly number[];
  baseline: FanScenario;
  scenarios: readonly FanScenario[];
  budgetYen: number | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = scenarios.find((s) => s.id === selected) ?? baseline;
  const last = days.length - 1;
  const todayCum = actualCumulative[actualCumulative.length - 1] ?? 0;
  const maxY = niceCeil(
    Math.max(
      baseline.landing.p90,
      ...scenarios.map((s) => s.landing.p90),
      budgetYen ?? 0,
      todayCum,
    ) * 1.05,
  );
  const x = (i: number) => LEFT + (last === 0 ? 0 : (i / last) * (RIGHT - LEFT));
  const y = (v: number) => BOTTOM - (v / maxY) * (BOTTOM - TOP);
  const f = (n: number) => n.toFixed(1);

  const future: number[] = [];
  for (let i = todayIndex; i <= last; i += 1) future.push(i);
  const span = Math.max(1, last - todayIndex);
  const fan = future.map((i) =>
    fanAt({ todayCumulative: todayCum, landing: current.landing, fraction: (i - todayIndex) / span }),
  );
  const band = (hi: (k: number) => number, lo: (k: number) => number) => {
    const up = future.map((i, k) => `${k ? 'L' : 'M'}${f(x(i))} ${f(y(hi(k)))}`).join(' ');
    const down = [...future]
      .map((i, k) => ({ i, k }))
      .reverse()
      .map(({ i, k }) => `L${f(x(i))} ${f(y(lo(k)))}`)
      .join(' ');
    return `${up} ${down} Z`;
  };
  const band80 = band(
    (k) => fan[k]!.p90,
    (k) => fan[k]!.p10,
  );
  const band50 = band(
    (k) => fan[k]!.p75,
    (k) => fan[k]!.p25,
  );
  const median = future.map((i, k) => `${k ? 'L' : 'M'}${f(x(i))} ${f(y(fan[k]!.p50))}`).join(' ');
  const actual = actualCumulative.map((v, i) => `${i ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`).join(' ');
  const end = fan[fan.length - 1] ?? { p10: todayCum, p50: todayCum, p90: todayCum };
  const ticks = [maxY / 2, maxY];
  const xLabels = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];

  const label = `${days[0]}から今日までの使った額と、${days[last]}までの見込みの帯。月末の中央は${approxYen(end.p50)}${budgetYen !== null ? `、予算は${approxYen(budgetYen, { approx: false })}` : ''}`;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
            <text x={LEFT + 2} y={y(t) - 4} className="text-xs" fill="var(--ink-muted)">
              {approxYen(t, { unit: false, approx: false })}
            </text>
          </g>
        ))}
        <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} stroke="var(--hairline)" />
        <path d={band80} fill="var(--state-ok-track)" />
        <path d={band50} fill="var(--state-ok)" opacity={0.25} />
        {budgetYen !== null ? (
          <g>
            <line
              x1={LEFT}
              x2={RIGHT}
              y1={y(budgetYen)}
              y2={y(budgetYen)}
              stroke="var(--ink)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={LEFT + 52} y={y(budgetYen) - 6} className="text-xs" fill="var(--ink)">
              予算 {approxYen(budgetYen, { unit: false, approx: false })}
            </text>
          </g>
        ) : null}
        <line
          x1={x(todayIndex)}
          x2={x(todayIndex)}
          y1={TOP}
          y2={BOTTOM}
          stroke="var(--ink-muted)"
          strokeDasharray="2 3"
        />
        <path d={median} fill="none" stroke="var(--state-ok)" strokeWidth={2} strokeDasharray="4 3" />
        <path
          d={actual}
          fill="none"
          stroke="var(--state-ok)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x={RIGHT + 6} y={y(end.p90) + 4} className="text-xs" fill="var(--ink-secondary)">
          {approxYen(end.p90, { unit: false, approx: false })}
        </text>
        <text x={RIGHT + 6} y={y(end.p50) + 4} className="text-xs" fill="var(--ink)" fontWeight={700}>
          {approxYen(end.p50, { unit: false, approx: false })}
        </text>
        <text x={RIGHT + 6} y={y(end.p10) + 4} className="text-xs" fill="var(--ink-secondary)">
          {approxYen(end.p10, { unit: false, approx: false })}
        </text>
        {xLabels.map((i, k) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            className="text-xs"
            fill="var(--ink-muted)"
            textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 ? 'end' : 'middle'}
          >
            {days[i]}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        <span>━ 使った額</span>
        <span>┅ 中央</span>
        <span>
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-3 rounded-full align-middle"
            style={{ background: 'var(--state-ok)', opacity: 0.4 }}
          />
          10回中5回
        </span>
        <span>
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-3 rounded-full align-middle"
            style={{ background: 'var(--state-ok-track)' }}
          />
          10回中8回
        </span>
      </div>

      {scenarios.length > 0 ? (
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            打ち手(押すとグラフが切り替わります)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {scenarios.map((s) => {
              const on = s.id === selected;
              const before = baseline.probWithinBudget;
              const after = s.probWithinBudget;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(on ? null : s.id)}
                  className="min-h-11 rounded-full px-4 text-sm font-semibold"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--plane)',
                    color: on ? 'var(--on-accent)' : 'var(--ink)',
                  }}
                >
                  {s.label}
                  {before !== null && after !== null
                    ? ` ${Math.round(before * 100)}% → ${Math.round(after * 100)}%`
                    : ` ${approxYen(baseline.landing.p50, { unit: false })} → ${approxYen(s.landing.p50, { unit: false })}`}
                </button>
              );
            })}
          </div>
          {selected !== null && current.probWithinBudget !== null ? (
            <p role="status" className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {current.label}と、予算に収まるのは10回中{outOfTen(current.probWithinBudget)}回
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
