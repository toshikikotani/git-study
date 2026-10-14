'use client';

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';

export type AllowanceExplain = {
  budgetYen: number;
  spentYen: number;
  spentTodayYen: number;
  remainingDays: number;
  capYen: number;
  /** 予算に収まる確率(今の状態)。 */
  probWithinBudget?: number | null;
  /** 残りの休日数(土日祝)。 */
  remainingDayOffs?: number | undefined;
  /** 休日の1日あたり見込み(過去データから)。 */
  dayOffPerDayYen?: number | null;
  /** 平日の1日あたり見込み(過去データから)。 */
  weekdayPerDayYen?: number | null;
  /** 今日の上限の計算結果。 */
  dailyLimit?: {
    todayLimitYen: number;
    weekdayAllocYen: number;
    dayOffAllocYen: number;
    ratio: number;
    safetyFactor: number;
    steps: string[];
  } | null;
};

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

/** 今日の上限の内訳。見通しへは飛ばさず、この場で棒グラフを出す。 */
export function AllowanceDialog({ explain }: { explain: AllowanceExplain }) {
  const [open, setOpen] = useState(false);
  const spentBefore = Math.max(0, explain.spentYen - explain.spentTodayYen);
  const leftBudget = explain.budgetYen - spentBefore;
  const cap = explain.dailyLimit?.todayLimitYen ?? explain.capYen;
  const over = explain.spentTodayYen - cap;
  const max = Math.max(explain.budgetYen, explain.spentYen, cap, explain.spentTodayYen, 1);
  const bar = (value: number, color: string) => (
    <span
      aria-hidden
      className="mt-1 block h-3 rounded-full"
      style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: color }}
    />
  );
  const prob = explain.probWithinBudget;
  const probText =
    prob !== null && prob !== undefined
      ? prob >= 0.995
        ? '99%以上'
        : `${Math.round(prob * 100)}%`
      : null;
  // 単純な1日あたり（残り予算 ÷ 残り日数）
  const simplePerDay =
    explain.remainingDays > 0 ? Math.round(leftBudget / explain.remainingDays) : 0;
  const dayOffs = explain.remainingDayOffs ?? 0;
  const weekdays = explain.remainingDays - dayOffs;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-11 items-center text-base font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        なぜこの額?
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        role="dialog"
        label="今日の上限の計算"
      >
        <div className="space-y-3 px-4 pb-4">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
            今日の上限の計算
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            過去の支出パターンから、休日は平日より多く使う傾向があるため、休日に重みをかけています。
          </p>
          <ul className="space-y-3">
            <li>
              <span className="flex justify-between text-sm" style={{ color: 'var(--ink)' }}>
                <span>予算</span>
                <span className="tabular">{yen(explain.budgetYen)}</span>
              </span>
              {bar(explain.budgetYen, 'var(--ink-muted)')}
            </li>
            <li>
              <span className="flex justify-between text-sm" style={{ color: 'var(--ink)' }}>
                <span>今日より前に使った額</span>
                <span className="tabular">{yen(spentBefore)}</span>
              </span>
              {bar(spentBefore, 'var(--accent)')}
            </li>
            <li>
              <span className="flex justify-between text-sm" style={{ color: 'var(--ink)' }}>
                <span>今日の上限</span>
                <span className="tabular">{yen(cap)}</span>
              </span>
              {bar(cap, 'var(--mark, var(--accent))')}
            </li>
            <li>
              <span className="flex justify-between text-sm" style={{ color: 'var(--ink)' }}>
                <span>今日使った額</span>
                <span className="tabular">{yen(explain.spentTodayYen)}</span>
              </span>
              {bar(explain.spentTodayYen, 'var(--state-caution)')}
            </li>
          </ul>
          <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--plane)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              計算の毎階
            </p>
            <ol
              className="mt-1 space-y-1 text-xs leading-relaxed"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <li>
                1. 残り予算 = {yen(explain.budgetYen)} − {yen(spentBefore)} = {yen(leftBudget)}
              </li>
              <li>
                2. 単純な1日あたり = {yen(leftBudget)} ÷ {explain.remainingDays}日 ={' '}
                {yen(simplePerDay)}
              </li>
              {explain.dailyLimit ? (
                explain.dailyLimit.steps.map((s, i) => (
                  <li key={i}>
                    {i + 3}. {s}
                  </li>
                ))
              ) : (
                <li>3. 今日の上限 = {yen(cap)}（残り予算を休日/平日の比率で配分した平日分）</li>
              )}
            </ol>
          </div>
          {dayOffs > 0 &&
          explain.dayOffPerDayYen != null &&
          explain.weekdayPerDayYen != null &&
          explain.dayOffPerDayYen > 0 &&
          explain.weekdayPerDayYen > 0 ? (
            <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--plane)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                残りの日の内訳
              </p>
              <ul
                className="mt-1 space-y-1 text-xs leading-relaxed"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <li>・残り休日(土日祝): {dayOffs}日</li>
                <li>・残り平日: {weekdays}日</li>
                {explain.dailyLimit ? (
                  <>
                    <li>・平日の配分: 1日{yen(explain.dailyLimit.weekdayAllocYen)}</li>
                    <li>
                      ・休日の配分: 1日{yen(explain.dailyLimit.dayOffAllocYen)}(比率
                      {explain.dailyLimit.ratio.toFixed(1)}倍)
                    </li>
                    <li className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                      残り予算を休日/平日の中央値の比率で配分し、確率
                      {((explain.probWithinBudget ?? 1) * 100) | 0}%で絞った数字です。
                    </li>
                  </>
                ) : explain.dayOffPerDayYen != null && explain.weekdayPerDayYen != null ? (
                  <>
                    <li>・平日は1日{yen(explain.weekdayPerDayYen)}くらい(過去の中央値)</li>
                    <li>・休日は1日{yen(explain.dayOffPerDayYen)}くらい(過去の中央値)</li>
                  </>
                ) : null}
              </ul>
            </div>
          ) : null}
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
            {over > 0
              ? `今日は${yen(explain.spentTodayYen)}使ったので、上限を${yen(over)}超えています。`
              : `今日は${yen(explain.spentTodayYen)}なので、あと${yen(cap - explain.spentTodayYen)}使えます。`}
          </p>
          {probText !== null ? (
            <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--plane)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                今の状態での確率
              </p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                今のペースが続くと、{probText}の確率で予算内に収まります。
                {over > 0
                  ? '今日の上限を超えているので、このままだと確率は下がります。'
                  : '今日の上限内に収まっているので、確率は保たれています。'}
              </p>
            </div>
          ) : null}
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            休日の重みは、直近90日の実績から「休日(土日祝)の1日あたり」と「平日の1日あたり」を計算し、その比率を使っています。
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-12 w-full rounded-full text-base font-semibold"
            style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          >
            閉じる
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
