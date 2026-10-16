'use client';

import { useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';
import type { CumulativeDay } from '@/features/category/pace';
import { SpeakButton } from '../_home/speak-button';

/** 「すべての支出」または「変えられる支出だけ」の見込みとグラフの材料。 */
export type ScopeData = {
  budgetYen: number;
  p10: number;
  p50: number;
  p90: number;
  /** 期間の日ごとの累計(実績・理想・予測の帯)。 */
  days: readonly CumulativeDay[];
  /** 今日までの使った額。 */
  spentYen: number;
};

const SCOPES = [
  { value: 'all', label: 'すべての支出' },
  { value: 'changeable', label: '変えられる支出だけ' },
] as const;

const MODES = [
  { value: 'cumulative', label: '累計' },
  { value: 'daily', label: '日別' },
] as const;

/** 2026-10-16 → 10/16 */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 実績のある最後の日(今日)の番号。無ければ -1。 */
function lastActual(days: readonly CumulativeDay[]): number {
  for (let i = days.length - 1; i >= 0; i -= 1) if (days[i]!.actualYen !== null) return i;
  return -1;
}

/** グラフの右端の金額「16.9万」「8,300」。 */
function axisYen(yen: number): string {
  return formatEstimate(yen, { approx: false }).replace('円', '');
}

/**
 * 見通しの先頭(デザイン仕様書の「見通し」、ADR-090):対象の切り替え → 予算との差のバッジ、見込み(中央)と
 * 予算、10回中8回の幅 → 累計/日別のグラフ(使った額・見込み・幅・予算までの理想)→ 理想ペースとの差。
 */
export function ForecastHero({
  all,
  changeable,
  endLabel,
  remainingDays,
}: {
  all: ScopeData;
  changeable: ScopeData | null;
  /** 「11月5日」 */
  endLabel: string;
  /** 今日を含む残りの日数。 */
  remainingDays: number;
}) {
  const [scope, setScope] = useState<'all' | 'changeable'>('all');
  const [mode, setMode] = useState<'cumulative' | 'daily'>('cumulative');
  const data = scope === 'changeable' && changeable ? changeable : all;
  const overYen = data.p50 - data.budgetYen;
  const today = lastActual(data.days);
  const idealToday = today >= 0 ? data.days[today]?.idealYen : null;
  const delta = idealToday !== null && idealToday !== undefined ? data.spentYen - idealToday : null;
  const leftYen = data.budgetYen - data.spentYen;
  const perDay = remainingDays > 0 ? Math.round(leftYen / remainingDays) : null;
  const spoken = `使った額は${formatYen(data.spentYen, { sign: 'never' })}${
    delta !== null
      ? `で、予算までの理想ペースより${formatEstimate(Math.abs(delta))}${delta > 0 ? '多い' : '少ない'}`
      : ''
  }。${endLabel}には${formatEstimate(data.p50)}の見込み。10回中8回は${formatEstimateRange(data.p10, data.p90)}。予算は${formatEstimate(data.budgetYen, { approx: false })}。`;

  return (
    <>
      {changeable ? (
        <Segmented
          value={scope}
          options={SCOPES}
          onChange={setScope}
          label="対象"
          className="grid w-full grid-cols-2"
        />
      ) : null}
      <section
        aria-label="見込み"
        className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
      >
        <span
          className="self-start rounded-full px-3 py-1 text-[13px] font-semibold"
          style={
            overYen > 0
              ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
              : { background: 'var(--income-track)', color: 'var(--income)' }
          }
        >
          {overYen > 0
            ? `予算を${formatEstimate(overYen)} 超えそう`
            : `予算まで${formatEstimate(-overYen)}の余裕`}
        </span>
        <p className="tabular mt-3 flex flex-wrap items-baseline gap-2">
          <span className="text-[40px] leading-tight font-bold tracking-[-0.01em]">
            {formatEstimate(data.p50)}
          </span>
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            / 予算 {formatEstimate(data.budgetYen, { approx: false })}
          </span>
        </p>
        <span className="tabular text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          10回中8回は {formatEstimateRange(data.p10, data.p90)} に収まる見込み
        </span>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Segmented value={mode} options={MODES} onChange={setMode} label="グラフ" />
          <SpeakButton label="グラフを音で聞く" text={spoken} icon />
        </div>

        {mode === 'cumulative' ? (
          <CumulativeSvg data={data} label={spoken} />
        ) : (
          <DailySvg data={data} />
        )}

        <div
          className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <Legend
            swatch={<span className="h-1 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />}
          >
            使った額
          </Legend>
          <Legend
            swatch={
              <span className="w-4" style={{ borderTop: '2px dashed var(--caution-mark)' }} />
            }
          >
            見込み（中央）
          </Legend>
          <Legend
            swatch={
              <span className="h-3 w-4 rounded-sm" style={{ background: 'var(--band-outer)' }} />
            }
          >
            10回中8回の幅
          </Legend>
          <Legend
            swatch={<span className="w-4" style={{ borderTop: '2px dotted var(--ideal)' }} />}
          >
            予算までの理想
          </Legend>
        </div>
        {delta !== null ? (
          <p
            className="tabular mt-4 rounded-xl px-4 py-3 text-[14px] leading-relaxed"
            style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
          >
            今日までは理想ペースより{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {formatYen(Math.abs(Math.round(delta)), { sign: 'never' })}
            </strong>{' '}
            {delta > 0 ? '多め' : '少なめ'}。
            {perDay !== null && perDay > 0 ? (
              <>
                残りを1日{' '}
                <strong style={{ color: 'var(--ink)' }}>
                  {formatYen(perDay, { sign: 'never' })}
                </strong>{' '}
                にすると予算どおりに着地します。
              </>
            ) : leftYen < 0 ? (
              <>もう予算を {formatYen(-leftYen, { sign: 'never' })} こえています。</>
            ) : null}
          </p>
        ) : null}
      </section>
    </>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}

const W = 326;
const X0 = 4;
const X1 = 294;

/** 累計のグラフ(使った額の線・見込みの帯と中央・予算の点線・予算までの理想)。 */
function CumulativeSvg({ data, label }: { data: ScopeData; label: string }) {
  const H = 200;
  const top = 14;
  const bottom = 170;
  const days = data.days;
  const n = days.length;
  if (n === 0) return null;
  const last = lastActual(days);
  const peak = Math.max(
    data.budgetYen,
    ...days.map((d) => Math.max(d.actualYen ?? 0, d.forecastHighYen ?? 0, d.idealYen ?? 0)),
    1,
  );
  const max = peak * 1.06;
  const x = (i: number) => X0 + (n <= 1 ? 0 : (i / (n - 1)) * (X1 - X0));
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const pt = (i: number, v: number) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;

  const nowYen = last >= 0 ? (days[last]?.actualYen ?? 0) : 0;
  const origin = last >= 0 ? pt(last, nowYen) : pt(0, 0);
  const future = days.filter((d) => d.index > last && d.forecastYen !== null);
  const band = (lo: keyof CumulativeDay, hi: keyof CumulativeDay) => {
    const rows = future.filter((d) => d[lo] !== null && d[hi] !== null);
    if (rows.length === 0) return null;
    const upper = rows.map((d) => pt(d.index, d[hi] as number));
    const lower = [...rows].reverse().map((d) => pt(d.index, d[lo] as number));
    return `M${origin} L${upper.join(' L')} L${lower.join(' L')} Z`;
  };
  const outer = band('forecastLowYen', 'forecastHighYen');
  const inner = band('forecastInnerLowYen', 'forecastInnerHighYen');
  const median =
    future.length > 0
      ? `M${origin} L${future.map((d) => pt(d.index, d.forecastYen as number)).join(' L')}`
      : null;
  const end = future.at(-1);
  const idealPts = days.filter((d) => d.idealYen !== null);
  const ideal =
    idealPts.length > 1
      ? `M${idealPts.map((d) => pt(d.index, d.idealYen as number)).join(' L')}`
      : null;
  const actual =
    last >= 0
      ? `M${days
          .slice(0, last + 1)
          .map((d) => pt(d.index, d.actualYen ?? 0))
          .join(' L')}`
      : null;

  // 右端の金額(上振れ・中央・予算)。重ならないように下へずらす。
  const tags = [
    ...(end && end.forecastHighYen !== null
      ? [{ key: 'high', y: y(end.forecastHighYen), h: 14 }]
      : []),
    ...(end && end.forecastYen !== null ? [{ key: 'mid', y: y(end.forecastYen), h: 14 }] : []),
    { key: 'budget', y: y(data.budgetYen) - 4, h: 28 },
  ].sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i += 1) {
    const prev = tags[i - 1]!;
    const cur = tags[i]!;
    if (cur.y < prev.y + prev.h) cur.y = prev.y + prev.h;
  }
  const tagY = (key: string) => tags.find((t) => t.key === key)?.y ?? 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={label}
      className="mt-3"
      style={{ overflow: 'visible' }}
    >
      <line x1={X0} y1={bottom} x2={X1} y2={bottom} stroke="var(--bar-quiet)" strokeWidth="1" />
      <line
        x1={X0}
        y1={y(data.budgetYen)}
        x2={X1}
        y2={y(data.budgetYen)}
        stroke="var(--ink)"
        strokeWidth="1.2"
        strokeDasharray="4 4"
      />
      <text x="298" y={tagY('budget') + 8} fontSize="11" fill="var(--ink)" fontWeight="600">
        予算
      </text>
      <text x="298" y={tagY('budget') + 22} fontSize="11" fill="var(--ink-secondary)">
        {axisYen(data.budgetYen)}
      </text>
      {outer ? <path d={outer} fill="var(--band-outer)" /> : null}
      {inner ? <path d={inner} fill="var(--band-inner)" /> : null}
      {median ? (
        <path
          d={median}
          fill="none"
          stroke="var(--caution-mark)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
      ) : null}
      {end && end.forecastYen !== null ? (
        <>
          <circle
            cx={x(end.index)}
            cy={y(end.forecastYen)}
            r="4"
            fill="var(--surface)"
            stroke="var(--caution-mark)"
            strokeWidth="2.5"
          />
          {end.forecastHighYen !== null ? (
            <text x="298" y={tagY('high') + 8} fontSize="11" fill="var(--ink-muted)">
              {axisYen(end.forecastHighYen)}
            </text>
          ) : null}
          <text
            x="298"
            y={tagY('mid') + 8}
            fontSize="11"
            fill="var(--state-caution)"
            fontWeight="600"
          >
            {axisYen(end.forecastYen)}
          </text>
        </>
      ) : null}
      {ideal ? (
        <path
          d={ideal}
          fill="none"
          stroke="var(--ideal)"
          strokeWidth="1.4"
          strokeDasharray="1.5 3.5"
          strokeLinecap="round"
        />
      ) : null}
      {last >= 0 && last < n - 1 ? (
        <>
          <line
            x1={x(last)}
            y1="20"
            x2={x(last)}
            y2={bottom}
            stroke="var(--bar-quiet)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          <text x={x(last)} y="12" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
            今日
          </text>
        </>
      ) : null}
      {actual ? (
        <>
          <path
            d={actual}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={x(last)}
            cy={y(nowYen)}
            r="5"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        </>
      ) : null}
      <AxisLabels days={days} last={last} y={H - 12} x={x} />
    </svg>
  );
}

/** 横軸の日付(はじまり・今日・おわり)。 */
function AxisLabels({
  days,
  last,
  y,
  x,
}: {
  days: readonly CumulativeDay[];
  last: number;
  y: number;
  x: (i: number) => number;
}) {
  const n = days.length;
  const first = days[0];
  const end = days[n - 1];
  if (!first || !end) return null;
  const showToday = last > 0 && last < n - 1 && x(last) - x(0) > 36 && x(n - 1) - x(last) > 36;
  return (
    <>
      <text x={x(0)} y={y} fontSize="11" fill="var(--ink-muted)">
        {md(first.date)}
      </text>
      {showToday ? (
        <text x={x(last)} y={y} fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
          {md(days[last]!.date)}
        </text>
      ) : null}
      <text x={x(n - 1)} y={y} fontSize="11" fill="var(--ink-muted)" textAnchor="end">
        {md(end.date)}
      </text>
    </>
  );
}

/** 日別のグラフ(1日の使った額の棒と、予算の1日あたりの点線)。 */
function DailySvg({ data }: { data: ScopeData }) {
  const H = 170;
  const bottom = 140;
  const days = data.days;
  const n = days.length;
  if (n === 0) return null;
  const last = lastActual(days);
  const spend = days.map((d, i) =>
    d.actualYen === null
      ? null
      : Math.max(0, d.actualYen - (i > 0 ? (days[i - 1]?.actualYen ?? 0) : 0)),
  );
  const pace = data.budgetYen / n;
  const max = Math.max(pace, ...spend.map((v) => v ?? 0), 1) * 1.15;
  const slot = (X1 - X0) / n;
  const barW = Math.max(2, slot * 0.66);
  const x = (i: number) => X0 + slot * i + slot / 2;
  const y = (v: number) => bottom - (v / max) * (bottom - 10);
  const over = spend.filter((v) => v !== null && v > pace).length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`1日ごとの使った額。予算の1日あたり${formatYen(Math.round(pace), { sign: 'never' })}を超えた日が${over}日。`}
      className="mt-3"
      style={{ overflow: 'visible' }}
    >
      <line x1={X0} y1={bottom} x2={X1} y2={bottom} stroke="var(--bar-quiet)" />
      {spend.map((v, i) =>
        v === null || v <= 0 ? null : (
          <rect
            key={days[i]!.date}
            x={x(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={bottom - y(v)}
            rx={Math.min(3, barW / 2)}
            fill={v > pace ? 'var(--accent)' : 'var(--bar-quiet)'}
          />
        ),
      )}
      <line
        x1={X0}
        y1={y(pace)}
        x2={X1}
        y2={y(pace)}
        stroke="var(--caution-mark)"
        strokeWidth="1.2"
        strokeDasharray="4 3"
      />
      <text x="298" y={y(pace) + 4} fontSize="11" fill="var(--ink-secondary)">
        {axisYen(Math.round(pace))}
      </text>
      <AxisLabels days={days} last={last} y={H - 12} x={x} />
    </svg>
  );
}
