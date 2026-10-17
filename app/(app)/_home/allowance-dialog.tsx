'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { formatProbability } from '@/domain/forecast/format';
import type { DailyLimitResult } from '@/features/forecast/daily-limit';

export type AllowanceExplain = {
  budgetYen: number;
  /** 今期に使った額(今日の分も入る)。 */
  spentYen: number;
  spentTodayYen: number;
  /** 今日を入れた残りの日数。 */
  remainingDays: number;
  capYen: number;
  /** 予定の額。 */
  scheduledYen?: number;
  /** 固定費。 */
  fixedYen?: number;
  /** 目標内に収まる確率(今の状態)。 */
  probWithinBudget?: number | null;
  /** 残りの休日数(土日祝)。 */
  remainingDayOffs?: number | undefined;
  /** 休日の1日あたり見込み(過去データから)。 */
  dayOffPerDayYen?: number | null;
  /** 平日の1日あたり見込み(過去データから)。 */
  weekdayPerDayYen?: number | null;
  /** 今日の上限の計算結果。 */
  dailyLimit?: DailyLimitResult | null;
  /** 明日からの目安の計算結果(デザイン v3-9)。 */
  tomorrowLimit?: DailyLimitResult | null;
  /** 今日(「土曜 · 休日」に使う)。 */
  today?: string;
  /** 明日から期間の終わりまでの日(休日か・祝日か)。 */
  days?: readonly { date: string; dayOff: boolean; holiday: boolean }[];
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

function num(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

/** 確率でどれだけ控えめにしたかの一文(「目標内に収まる確率が1%と低いので、約半分にしています」)。 */
export function carefulSentence(prob: number | null, safetyFactor: number): string {
  const pct = Math.round(safetyFactor * 100);
  if (prob === null) return `念のため、${pct}%にしています`;
  const p = formatProbability(prob);
  if (pct <= 55) return `目標内に収まる確率が${p}と低いので、約半分にしています`;
  if (prob < 0.5) return `目標内に収まる確率が${p}と低めなので、${pct}%にしています`;
  return `目標内に収まる確率が${p}なので、少し控えめ(${pct}%)にしています`;
}

/** 日ごとの棒の下の文字:明日・月の初め・祝日・期間の最後と、5の倍数の日。 */
function dayLabel(date: string, i: number, last: boolean, holiday: boolean): string {
  const d = Number(date.slice(8, 10));
  if (holiday) return '祝';
  if (d === 1) return `${Number(date.slice(5, 7))}/1`;
  if (i === 0 || last || d % 5 === 0) return String(d);
  return '';
}

/**
 * なぜこの額？(デザイン v3-9「簡単版」、ADR-109)。今日の目安 → こうやって決めています(目標の残り →
 * 残りの日に分ける → 控えめにする)→ こえた分・残った分は明日からに回る(日ごとの棒)→ 計算式(たたむ)。
 */
export function AllowanceDialog({ explain }: { explain: AllowanceExplain }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold"
        style={{ background: 'var(--plane)', color: 'var(--ink)' }}
      >
        なぜこの額？
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        role="dialog"
        label="なぜこの額？"
        tall
      >
        {open ? <AllowanceExplainBody explain={explain} onClose={() => setOpen(false)} /> : null}
      </BottomSheet>
    </>
  );
}

export function AllowanceExplainBody({
  explain,
  onClose,
}: {
  explain: AllowanceExplain;
  onClose: () => void;
}) {
  const [showFormula, setShowFormula] = useState(false);
  const limit = explain.dailyLimit ?? null;
  const tomorrow = explain.tomorrowLimit ?? null;
  const cap = limit?.todayLimitYen ?? explain.capYen;
  const over = explain.spentTodayYen - cap;
  const spentBefore = Math.max(0, explain.spentYen - explain.spentTodayYen);
  const scheduled = explain.scheduledYen ?? 0;
  const fixed = explain.fixedYen ?? 0;
  const left =
    limit?.input.leftBudgetYen ?? Math.max(0, explain.budgetYen - spentBefore - scheduled - fixed);
  const dayOffs = limit?.input.remainingDayOffs ?? explain.remainingDayOffs ?? 0;
  const weekdays = limit?.input.remainingWeekdays ?? explain.remainingDays - dayOffs;
  const todayIsDayOff = limit?.todayIsDayOff ?? false;
  const todayLabel = explain.today
    ? `${WEEKDAYS[new Date(`${explain.today}T00:00:00Z`).getUTCDay()]}曜 · ${todayIsDayOff ? '休日' : '平日'}`
    : null;
  const days = explain.days ?? [];
  const prob = explain.probWithinBudget ?? null;

  const chip = (label: string, value: number, on: boolean) => (
    <span
      className="tabular rounded-[10px] px-3 py-1 text-[15px]"
      style={{
        background: on ? 'var(--note)' : 'var(--plane)',
        color: 'var(--ink)',
        boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
      }}
    >
      {label} <strong>{yen(value)}</strong>
    </span>
  );

  return (
    <div className="flex flex-col gap-3 pt-1 pb-6" style={{ color: 'var(--ink)' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <span />
        <span className="text-[17px] font-semibold">なぜこの額？</span>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center justify-self-end text-[17px] font-bold"
          style={{ color: 'var(--accent)' }}
        >
          閉じる
        </button>
      </div>

      <section
        className="flex flex-col gap-1 rounded-[20px] px-4 pt-4 pb-3"
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            今日の目安
          </span>
          {todayLabel ? (
            <span
              className="rounded-full px-3 py-1 text-[12px] font-bold"
              style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
            >
              {todayLabel}
            </span>
          ) : null}
        </div>
        <p className="tabular flex items-baseline gap-1">
          <span className="text-[40px] leading-tight font-bold tracking-[-0.01em]">{num(cap)}</span>
          <span className="text-[20px] font-semibold">円</span>
        </p>
        <div
          className="tabular mt-2 flex items-center justify-between gap-2 pt-3 text-[15px]"
          style={{ borderTop: '1px solid var(--hairline)' }}
        >
          <span style={{ color: 'var(--ink-secondary)' }}>
            今日使った額 {yen(explain.spentTodayYen)}
          </span>
          <strong style={{ color: over > 0 ? 'var(--state-caution)' : 'var(--income)' }}>
            {over > 0 ? `${yen(over)} こえ` : `あと ${yen(-over)}`}
          </strong>
        </div>
      </section>

      <h2 className="px-1 pt-2 text-[17px] font-bold">こうやって決めています</h2>
      <ol className="flex flex-col">
        <Step n={1} last={false}>
          <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
            目標の残り
          </span>
          <span className="tabular text-[24px] font-bold">{yen(left)}</span>
          <span
            className="tabular text-[13px] leading-normal"
            style={{ color: 'var(--ink-muted)' }}
          >
            目標 {num(explain.budgetYen)} − 昨日までに使った {num(spentBefore)}
            {scheduled > 0 ? ` − 予定 ${num(scheduled)}` : ''}
            {fixed > 0 ? ` − 固定費 ${num(fixed)}` : ''}
          </span>
        </Step>
        {limit ? (
          <>
            <Step n={2} last={false}>
              <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                残り{dayOffs + weekdays}日に分ける
              </span>
              <span className="flex flex-wrap gap-2">
                {chip('休日', limit.baseDayOffYen, false)}
                {chip('平日', limit.baseWeekdayYen, false)}
              </span>
              <span className="text-[13px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
                {limit.ratio > 1.05
                  ? `休日はいつも平日の約${limit.ratio.toFixed(1)}倍使うので、多めに分けます`
                  : '休日も平日もおなじくらいに分けます'}
                （休日{dayOffs}日・平日{weekdays}日）
              </span>
            </Step>
            <Step n={3} last>
              <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                控えめにする
              </span>
              <span className="flex flex-wrap gap-2">
                {chip('休日', limit.dayOffAllocYen, todayIsDayOff)}
                {chip('平日', limit.weekdayAllocYen, !todayIsDayOff)}
              </span>
              <span className="text-[13px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
                {carefulSentence(prob, limit.safetyFactor)}
              </span>
            </Step>
          </>
        ) : (
          <Step n={2} last>
            <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
              残り{explain.remainingDays}日に分けて、控えめにする
            </span>
            <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              記録が少ないあいだは、休日と平日を分けずに出しています
            </span>
          </Step>
        )}
      </ol>

      {tomorrow ? (
        <section
          className="flex flex-col gap-3 rounded-[20px] px-4 pt-4 pb-3"
          style={{ background: 'var(--surface)' }}
        >
          <span className="flex flex-col gap-1">
            <span className="text-[15px] font-bold">
              {over > 0 ? 'こえた分は、明日からに回ります' : '残った分は、明日からに回ります'}
            </span>
            <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              明日から
              {days.length || tomorrow.input.remainingDayOffs + tomorrow.input.remainingWeekdays}
              日の目安 · 休日 約{num(Math.round(tomorrow.dayOffAllocYen / 10) * 10)}円 · 平日 約
              {num(Math.round(tomorrow.weekdayAllocYen / 10) * 10)}円
            </span>
          </span>
          {days.length > 0 ? (
            <>
              <div
                role="img"
                aria-label={`明日からの目安。休日は約${num(tomorrow.dayOffAllocYen)}円、平日は約${num(tomorrow.weekdayAllocYen)}円。`}
                className="grid h-16 items-end gap-1"
                style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
              >
                {days.map((d) => (
                  <span
                    key={d.date}
                    className="rounded-[3px]"
                    style={{
                      height: d.dayOff
                        ? '100%'
                        : `${Math.max(12, Math.round((tomorrow.weekdayAllocYen / Math.max(1, tomorrow.dayOffAllocYen)) * 100))}%`,
                      background: d.dayOff ? 'var(--accent)' : 'var(--bar-quiet)',
                    }}
                  />
                ))}
              </div>
              <div
                aria-hidden
                className="tabular grid gap-1 text-center text-[11px]"
                style={{
                  gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
                  color: 'var(--ink-muted)',
                }}
              >
                {days.map((d, i) => (
                  <span key={d.date} className="overflow-visible whitespace-nowrap">
                    {dayLabel(d.date, i, i === days.length - 1, d.holiday)}
                  </span>
                ))}
              </div>
              <div className="flex gap-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="size-3 rounded-[3px]"
                    style={{ background: 'var(--accent)' }}
                  />
                  休日(土日祝)
                </span>
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="size-3 rounded-[3px]"
                    style={{ background: 'var(--bar-quiet)' }}
                  />
                  平日
                </span>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {limit ? (
        <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
          <button
            type="button"
            onClick={() => setShowFormula(!showFormula)}
            aria-expanded={showFormula}
            className="flex min-h-13 items-center justify-between px-4 text-left text-[16px]"
          >
            計算式を見る
            <span
              aria-hidden
              style={{
                color: 'var(--ink-muted)',
                transform: showFormula ? 'rotate(90deg)' : 'none',
                transition: 'transform 150ms',
              }}
            >
              ›
            </span>
          </button>
          {showFormula ? (
            <div
              className="tabular flex flex-col gap-2 px-4 pt-3 pb-4 text-[13px] leading-relaxed"
              style={{ borderTop: '1px solid var(--hairline)', color: 'var(--ink-secondary)' }}
            >
              {limit.input.dayOffMedianYen !== null && limit.input.weekdayMedianYen !== null ? (
                <span>
                  休日の重み = 休日 {yen(limit.input.dayOffMedianYen)} ÷ 平日{' '}
                  {yen(limit.input.weekdayMedianYen)} = {limit.ratio.toFixed(2)}
                  <br />
                  <span style={{ color: 'var(--ink-muted)' }}>直近90日の1日あたり</span>
                </span>
              ) : null}
              <span>
                重み付き日数 = {dayOffs} × {limit.ratio.toFixed(2)} + {weekdays} ={' '}
                {(dayOffs * limit.ratio + weekdays).toFixed(1)}
              </span>
              <span>
                平日 = {num(left)} ÷ {(dayOffs * limit.ratio + weekdays).toFixed(1)} ={' '}
                {yen(limit.baseWeekdayYen)}
                <br />
                休日 = {num(limit.baseWeekdayYen)} × {limit.ratio.toFixed(2)} ={' '}
                {yen(limit.baseDayOffYen)}
              </span>
              <span>
                控えめ係数 = 0.5 + 確率 {prob === null ? '—' : formatProbability(prob)} × 0.5 ={' '}
                {limit.safetyFactor.toFixed(3)}
              </span>
              <span>
                今日の目安 = {num(todayIsDayOff ? limit.baseDayOffYen : limit.baseWeekdayYen)} ×{' '}
                {limit.safetyFactor.toFixed(3)} = {yen(cap)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Step({ n, last, children }: { n: number; last: boolean; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_1fr] gap-3">
      <span className="flex flex-col items-center">
        <span
          className="flex size-7 items-center justify-center rounded-full text-[14px] font-bold"
          style={{ background: 'var(--note)', color: 'var(--accent)' }}
        >
          {n}
        </span>
        {last ? null : (
          <span
            aria-hidden
            className="my-1 w-0.5 flex-1"
            style={{ background: 'var(--hairline)' }}
          />
        )}
      </span>
      <span className={`flex flex-col gap-1 ${last ? '' : 'pb-5'}`}>{children}</span>
    </li>
  );
}
