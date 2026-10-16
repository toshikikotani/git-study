'use client';

import { useState } from 'react';

import { GenreBadge } from '@/components/ui/genre-badge';
import { formatEstimate } from '@/domain/forecast/format';
import type { CumulativeDay } from '@/features/category/pace';
import { Switch } from '../../record-sheet';
import type { GoalCategory } from './goal-editor';
import { RoundButton } from './goal-editor';

/** 目標額の − / + とスライダーの刻み。 */
const STEP = 500;
const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

/** 2026-10-16 → 10/16 */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/**
 * カテゴリの目標額(デザイン仕様書の「カテゴリの目標額」、ADR-090):− / + とスライダー、
 * いまのまま・20%へらす・先月なみ、残りの1日あたり → そのカテゴリの見通しのグラフ → これまで・先月・判定 →
 * へらした分だけ総額も下げる。「完了」で今期の目標へ戻す(保存は今期の目標の「保存」)。
 */
export function CategoryTargetSheet({
  category,
  amountYen,
  today,
  periodStart,
  periodEnd,
  remainingDays,
  lowersTotalDefault,
  onCancel,
  onDone,
}: {
  category: GoalCategory;
  amountYen: number;
  today: string;
  periodStart: string;
  periodEnd: string;
  remainingDays: number;
  lowersTotalDefault: boolean;
  onCancel: () => void;
  onDone: (amountYen: number, lowersTotal: boolean) => void;
}) {
  const [amount, setAmount] = useState(amountYen);
  const [lowersTotal, setLowersTotal] = useState(lowersTotalDefault);
  const presets = [
    { label: 'いまのまま', value: category.targetYen },
    { label: '20%へらす', value: Math.round(category.targetYen * 0.8) },
    ...(category.lastMonthYen !== null
      ? [{ label: '先月なみ', value: Math.ceil(category.lastMonthYen / STEP) * STEP }]
      : []),
  ];
  const max = Math.max(
    60000,
    Math.ceil((Math.max(category.targetYen, category.p90 ?? 0, amount) * 1.5) / STEP) * STEP,
  );
  const left = amount - category.spentYen;
  const name = category.name;
  const over = category.p50 !== null ? category.p50 - amount : null;

  return (
    <div className="flex flex-col gap-4 pt-1" style={{ color: 'var(--ink)' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-11 items-center justify-self-start text-[17px]"
          style={{ color: 'var(--accent)' }}
        >
          キャンセル
        </button>
        <span className="flex items-center gap-2 text-[17px] font-semibold">
          <GenreBadge name={name} size={28} />
          {name}
        </span>
        <button
          type="button"
          onClick={() => onDone(amount, lowersTotal)}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold"
          style={{ color: 'var(--accent)' }}
        >
          完了
        </button>
      </div>

      <section
        className="flex flex-col gap-3 rounded-[20px] px-4 py-4"
        style={{ background: 'var(--surface)' }}
      >
        <span className="text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          今期の目標額
        </span>
        <div className="flex items-center justify-between">
          <RoundButton
            label={`${STEP}円へらす`}
            onClick={() => setAmount((v) => Math.max(0, v - STEP))}
            minus
            size={12}
          />
          <span className="tabular flex items-baseline gap-1">
            <span className="text-[40px] font-bold tracking-[-0.01em]">
              {amount.toLocaleString('ja-JP')}
            </span>
            <span className="text-[20px] font-semibold">円</span>
          </span>
          <RoundButton
            label={`${STEP}円ふやす`}
            onClick={() => setAmount((v) => v + STEP)}
            size={12}
          />
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={STEP}
          value={Math.min(amount, max)}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label={`${name}の目標額`}
          className="min-h-11 w-full"
          style={{ accentColor: 'var(--accent)' }}
        />
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p) => {
            const on = p.value === amount;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => setAmount(p.value)}
                className="tabular flex min-h-14 flex-col items-center justify-center rounded-[14px]"
                style={{
                  background: on ? 'var(--action)' : 'var(--plane)',
                  color: on ? 'var(--on-action)' : 'var(--ink)',
                }}
              >
                <span className="text-[12px] font-semibold">{p.label}</span>
                <span className="text-[15px] font-bold">{p.value.toLocaleString('ja-JP')}</span>
              </button>
            );
          })}
        </div>
        <p
          className="tabular rounded-xl px-4 py-3 text-center text-[14px] leading-relaxed"
          style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
        >
          {left > 0
            ? remainingDays > 0
              ? `残り${remainingDays}日で、${name}に使えるのは1日 約${yen(left / remainingDays)}`
              : `${name}はあと${yen(left)}使えます`
            : `もう ${yen(-left)} こえています。この金額だと残りは${name}なし`}
        </p>
      </section>

      <section
        className="flex flex-col rounded-[20px] px-4 pt-4 pb-4"
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] font-semibold">{name}の見通し</span>
          {over !== null ? (
            <span
              className="rounded-full px-2 py-1 text-[12px] font-bold"
              style={
                over > 0
                  ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
                  : { background: 'var(--income-track)', color: 'var(--income)' }
              }
            >
              {over > 0
                ? `このままだと${formatEstimate(over)}こえそう`
                : 'このペースなら収まりそう'}
            </span>
          ) : null}
        </div>
        <CategoryChart
          days={category.days}
          target={amount}
          name={name}
          endLabel={md(periodEnd)}
          p50={category.p50}
        />
        <div
          className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]"
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
            いまのペース
          </Legend>
          <Legend
            swatch={
              <span className="h-3 w-4 rounded-sm" style={{ background: 'var(--band-outer)' }} />
            }
          >
            10回中8回の幅
          </Legend>
          <Legend
            swatch={<span className="w-4" style={{ borderTop: '2px dotted var(--accent)' }} />}
          >
            目標までのペース
          </Legend>
        </div>
      </section>

      <div className="tabular flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        <Row
          label={`これまで（${md(periodStart)}〜${md(today < periodEnd ? today : periodEnd).split('/')[1]}）`}
        >
          <span className="font-semibold">{yen(category.spentYen)}</span>
        </Row>
        <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />
        <Row label="先月">
          <span className="font-semibold">
            {category.lastMonthYen !== null ? yen(category.lastMonthYen) : '—'}
          </span>
        </Row>
        <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />
        <Row label="判定">
          <span
            className="rounded-full px-2 py-1 text-[13px] font-bold"
            style={
              category.caution
                ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
                : { background: 'var(--income-track)', color: 'var(--income)' }
            }
          >
            {category.caution
              ? `見直し候補 · ${Math.round(category.caution.probability * 100)}%`
              : 'このままで大丈夫'}
          </span>
        </Row>
      </div>

      <div className="rounded-2xl" style={{ background: 'var(--surface)' }}>
        <label className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="flex flex-col">
            <span className="text-[16px]">へらした分だけ総額も下げる</span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              オフなら、ほかのカテゴリへ配り直します
            </span>
          </span>
          <Switch
            checked={lowersTotal}
            onChange={setLowersTotal}
            label="へらした分だけ総額も下げる"
          />
        </label>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between px-4 text-[15px]">
      <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
      {children}
    </div>
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

/** 使った額・いまのペース(中央)と10回中8回の幅・目標の点線・目標までのペース。 */
function CategoryChart({
  days,
  target,
  name,
  endLabel,
  p50,
}: {
  days: readonly CumulativeDay[];
  target: number;
  name: string;
  endLabel: string;
  p50: number | null;
}) {
  const W = 326;
  const top = 14;
  const bottom = 150;
  const x0 = 8;
  const x1 = 290;
  const n = days.length;
  if (n === 0) return null;
  let last = -1;
  for (let i = 0; i < n; i += 1) if (days[i]!.actualYen !== null) last = i;
  const peak = Math.max(
    target,
    ...days.map((d) => Math.max(d.actualYen ?? 0, d.forecastHighYen ?? 0)),
    1,
  );
  const max = peak * 1.1;
  const x = (i: number) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * (x1 - x0));
  const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);
  const pt = (i: number, v: number) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  const spent = last >= 0 ? (days[last]!.actualYen ?? 0) : 0;
  const origin = pt(Math.max(0, last), spent);
  const future = days.filter((d) => d.index > last && d.forecastYen !== null);
  const band =
    future.length > 0
      ? `M${origin} L${future.map((d) => pt(d.index, d.forecastHighYen ?? d.forecastYen!)).join(' L')} L${[
          ...future,
        ]
          .reverse()
          .map((d) => pt(d.index, d.forecastLowYen ?? d.forecastYen!))
          .join(' L')} Z`
      : null;
  const end = future.at(-1);
  const median =
    future.length > 0
      ? `M${origin} L${future.map((d) => pt(d.index, d.forecastYen!)).join(' L')}`
      : null;
  const actual =
    last >= 0
      ? `M${days
          .slice(0, last + 1)
          .map((d) => pt(d.index, d.actualYen ?? 0))
          .join(' L')}`
      : null;
  const ty = y(target);
  const man = (v: number) => formatEstimate(v, { approx: false }).replace('円', '');

  return (
    <svg
      viewBox={`0 0 ${W} 172`}
      width="100%"
      role="img"
      aria-label={`${name}はこれまで${yen(spent)}。${p50 !== null ? `いまのペースだと${endLabel}に${formatEstimate(p50)}。` : ''}目標は${yen(target)}。`}
      className="mt-3"
      style={{ overflow: 'visible' }}
    >
      <line x1={x0} y1={bottom} x2={x1} y2={bottom} stroke="var(--bar-quiet)" />
      {band ? <path d={band} fill="var(--band-outer)" /> : null}
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
            r="3.5"
            fill="var(--surface)"
            stroke="var(--caution-mark)"
            strokeWidth="2"
          />
          {Math.abs(y(end.forecastYen) - ty) > 12 ? (
            <text
              x="296"
              y={y(end.forecastYen) + 4}
              fontSize="11"
              fill="var(--state-caution)"
              fontWeight="600"
            >
              {man(end.forecastYen)}
            </text>
          ) : null}
        </>
      ) : null}
      <line
        x1={x0}
        y1={ty}
        x2={x1}
        y2={ty}
        stroke="var(--ink)"
        strokeWidth="1.4"
        strokeDasharray="4 4"
      />
      <text x="296" y={Math.max(ty + 4, 12)} fontSize="11" fill="var(--ink)" fontWeight="700">
        目標
      </text>
      {last >= 0 && last < n - 1 && target > spent ? (
        <line
          x1={x(last)}
          y1={y(spent)}
          x2={x1}
          y2={ty}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="1.5 4"
          strokeLinecap="round"
        />
      ) : null}
      {last >= 0 && last < n - 1 ? (
        <>
          <line
            x1={x(last)}
            y1="14"
            x2={x(last)}
            y2={bottom}
            stroke="var(--bar-quiet)"
            strokeDasharray="2 3"
          />
          <text x={x(last)} y="9" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
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
            strokeLinecap="round"
          />
          <circle
            cx={x(last)}
            cy={y(spent)}
            r="5"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        </>
      ) : null}
      <text x={x0} y="166" fontSize="11" fill="var(--ink-muted)">
        {md(days[0]!.date)}
      </text>
      {last > 0 && last < n - 1 ? (
        <text x={x(last)} y="166" fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
          {md(days[last]!.date)}
        </text>
      ) : null}
      <text x={x1} y="166" fontSize="11" fill="var(--ink-muted)" textAnchor="end">
        {endLabel}
      </text>
    </svg>
  );
}
