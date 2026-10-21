'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatEstimate, formatEstimateRange, formatProbability } from '@/domain/forecast/format';
import { formatYen } from '@/domain/money';
import type { CumulativeDay } from '@/features/category/pace';
import { ForecastDensity } from './forecast-density';

/** いまの状況の材料(目標の期間の確率予測)。 */
export type GoalStatus = {
  budgetYen: number;
  p10: number;
  p50: number;
  p90: number;
  /** 目標内に収まる確率。 */
  probWithin: number | null;
  /** 期間の日ごとの累計(実績・理想・予測の帯)。 */
  days: readonly CumulativeDay[];
  /** 今日までの使った額。 */
  spentYen: number;
  /** 本人の完了月が少なく、確率の検証が十分ではない。 */
  provisional?: boolean;
};

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
 * いまの状況(デザイン仕様書の「分析 › 目標」、ADR-091):今期の目標と期間・「編集」、着地見込みと
 * 10回中8回の幅の金額(ADR-094)、目標内の確率、こえそうな額、累計のグラフ(使った額・見込み・
 * 10回中8回の幅・目標までの理想)、残りの1日あたり、グラフを音で聞く。
 */
export function GoalStatusCard({
  status,
  periodLabel,
  endLabel,
  remainingDays,
}: {
  status: GoalStatus;
  /** 「10/1〜11/5 · 残り20日」 */
  periodLabel: string;
  /** 「11月5日」 */
  endLabel: string;
  remainingDays: number;
}) {
  const [note, setNote] = useState<string | null>(null);
  const overYen = status.p50 - status.budgetYen;
  const leftYen = status.budgetYen - status.spentYen;
  const perDay = remainingDays > 0 ? Math.round(leftYen / remainingDays) : null;
  const caution = status.probWithin !== null && status.probWithin < 0.5;
  const range = formatEstimateRange(status.p10, status.p90);
  const densityDays = status.days.filter((day) => day.forecastYen !== null);
  const hasDensity =
    densityDays.length > 0 && densityDays.every((day) => (day.forecastDensity?.length ?? 0) > 0);
  const densityNote = '同じ日の中で、濃いところほど予測が多い';
  const spoken = `使った額は${formatYen(status.spentYen, { sign: 'never' })}。${endLabel}には${formatEstimate(status.p50)}の見込みで、10回中8回は${range}の間。目標${formatEstimate(status.budgetYen, { approx: false })}を${overYen > 0 ? 'こえそう' : '下回りそう'}。${hasDensity ? `${densityNote}。` : ''}${status.provisional ? '記録が少ないため、確率は目安です。' : ''}`;
  const speak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setNote('この環境では読み上げできません。');
      return;
    }
    setNote(null);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'ja-JP';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section
      aria-label="いまの状況"
      className="flex flex-col rounded-2xl px-5 pt-5 pb-2"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="tabular flex flex-col">
          <span className="text-[17px] font-semibold">
            今期の目標 {formatEstimate(status.budgetYen, { approx: false })}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {periodLabel}
          </span>
        </span>
        <Link
          href="/plan/edit"
          className="flex min-h-11 items-center rounded-full px-4 text-[13px] font-semibold"
          style={{ background: 'var(--plane)', color: 'var(--accent)' }}
        >
          編集
        </Link>
      </div>
      <div className="tabular mt-4 flex items-end justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            着地見込み
          </span>
          <span className="text-[34px] leading-tight font-bold tracking-[-0.01em]">
            {formatEstimate(status.p50)}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            10回中8回は {range}
          </span>
        </span>
        {status.probWithin !== null ? (
          <span className="flex flex-col items-end">
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              目標内の確率
            </span>
            <span
              className="text-[28px] font-bold"
              style={{ color: caution ? 'var(--state-caution)' : 'var(--income)' }}
            >
              {formatProbability(status.probWithin)}
            </span>
          </span>
        ) : null}
      </div>
      <span
        className="mt-3 self-start rounded-full px-3 py-1 text-[13px] font-semibold"
        style={
          overYen > 0
            ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
            : { background: 'var(--income-track)', color: 'var(--income)' }
        }
      >
        {overYen > 0
          ? `${formatEstimate(overYen)} こえそう`
          : `目標まで${formatEstimate(-overYen)}の余裕`}
      </span>
      <CumulativeSvg data={status} label={spoken} />
      <div
        className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-[12px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <Legend
          swatch={<span className="h-1 w-4 rounded-sm" style={{ background: 'var(--accent)' }} />}
        >
          使った額
        </Legend>
        <Legend
          swatch={<span className="w-4" style={{ borderTop: '2px dashed var(--caution-mark)' }} />}
        >
          見込み
        </Legend>
        <Legend
          swatch={
            <span
              className="h-3 w-4 rounded-sm"
              style={{
                background: 'var(--band-outer)',
                boxShadow:
                  'inset 0 0 0 1px color-mix(in srgb, var(--caution-mark) 35%, transparent)',
              }}
            />
          }
        >
          10回中8回の幅
        </Legend>
        <Legend swatch={<span className="w-4" style={{ borderTop: '2px dotted var(--ideal)' }} />}>
          目標までの理想
        </Legend>
      </div>
      {hasDensity ? (
        <p
          className="mt-2 flex items-center gap-2 text-[12px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span
            aria-hidden="true"
            className="h-3 w-8 shrink-0 rounded-sm"
            style={{
              background:
                'linear-gradient(to right, transparent, color-mix(in srgb, var(--caution-mark) 70%, transparent))',
            }}
          />
          {densityNote}
        </p>
      ) : null}
      {status.provisional ? (
        <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          記録が少ないため、確率は目安です。
        </p>
      ) : null}
      <p
        className="tabular mt-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed"
        style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
      >
        {perDay !== null && perDay > 0 ? (
          <>
            残りを1日{' '}
            <strong style={{ color: 'var(--ink)' }}>{formatYen(perDay, { sign: 'never' })}</strong>{' '}
            にすると目標どおりに着地します。
          </>
        ) : leftYen < 0 ? (
          <>もう目標を {formatYen(-leftYen, { sign: 'never' })} こえています。</>
        ) : (
          <>目標どおりです。</>
        )}
      </p>
      <div className="mt-1 flex items-center justify-end gap-2">
        {note ? (
          <span role="status" className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {note}
          </span>
        ) : null}
        <button
          type="button"
          onClick={speak}
          className="flex min-h-11 items-center gap-2 px-1 text-[13px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <svg
            aria-hidden
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 10v4h4l5 4V6L8 10z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          </svg>
          グラフを音で聞く
        </button>
      </div>
    </section>
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
function CumulativeSvg({ data, label }: { data: GoalStatus; label: string }) {
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
  // 10回中8回の幅:今日の点から広がる帯。上下の縁に細い線を引き、帯の形がわかるようにする。
  const bandRows = future.filter((d) => d.forecastLowYen !== null && d.forecastHighYen !== null);
  const hasDensity =
    bandRows.length > 0 && bandRows.every((day) => (day.forecastDensity?.length ?? 0) > 0);
  const upperPts = bandRows.map((d) => pt(d.index, d.forecastHighYen as number));
  const lowerPts = bandRows.map((d) => pt(d.index, d.forecastLowYen as number));
  const outer =
    bandRows.length > 0
      ? `M${origin} L${upperPts.join(' L')} L${[...lowerPts].reverse().join(' L')} Z`
      : null;
  const edges =
    bandRows.length > 0
      ? [`M${origin} L${upperPts.join(' L')}`, `M${origin} L${lowerPts.join(' L')}`]
      : [];
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
      {outer ? (
        <path
          data-band="outer"
          d={outer}
          fill={hasDensity ? 'none' : 'var(--band-outer)'}
          fillOpacity="0.75"
        />
      ) : null}
      {hasDensity ? (
        <ForecastDensity
          rows={bandRows}
          x={x}
          y={y}
          origin={{ x: last >= 0 ? x(last) : x(0), yen: nowYen }}
        />
      ) : null}
      {edges.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--caution-mark)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      ))}
      {/* 目標の線は帯の上に引く(帯に隠れないように、ADR-094) */}
      <line
        data-line="budget"
        x1={X0}
        y1={y(data.budgetYen)}
        x2={X1}
        y2={y(data.budgetYen)}
        stroke="var(--ink)"
        strokeWidth="1.4"
        strokeDasharray="4 4"
      />
      <text x="298" y={tagY('budget') + 8} fontSize="11" fill="var(--ink)" fontWeight="600">
        目標
      </text>
      <text x="298" y={tagY('budget') + 22} fontSize="11" fill="var(--ink-secondary)">
        {axisYen(data.budgetYen)}
      </text>
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
