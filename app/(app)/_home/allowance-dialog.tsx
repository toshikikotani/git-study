'use client';

import { useState } from 'react';

export type AllowanceExplain = {
  budgetYen: number;
  spentYen: number;
  spentTodayYen: number;
  remainingDays: number;
};

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

/** 今日の上限の内訳。見通しへは飛ばさず、この場で棒グラフを出す。 */
export function AllowanceDialog({ explain }: { explain: AllowanceExplain }) {
  const [open, setOpen] = useState(false);
  const spentBefore = Math.max(0, explain.spentYen - explain.spentTodayYen);
  const leftBudget = explain.budgetYen - spentBefore;
  const cap = Math.max(0, Math.round(leftBudget / Math.max(1, explain.remainingDays)));
  const over = explain.spentTodayYen - cap;
  const max = Math.max(explain.budgetYen, explain.spentYen, cap, explain.spentTodayYen, 1);
  const bar = (value: number, color: string) => (
    <span
      aria-hidden
      className="mt-1 block h-3 rounded-full"
      style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: color }}
    />
  );
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
      {open ? (
        <div
          role="dialog"
          aria-label="今日の上限の計算"
          className="fixed inset-0 z-50 flex items-end justify-center p-3"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-3xl p-5"
            style={{ background: 'var(--surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
              今日の上限の計算
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              予算から、今日より前に使った額を引き、残り{explain.remainingDays}日で割っています。
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
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              {yen(explain.budgetYen)} − {yen(spentBefore)} = {yen(leftBudget)}。これを
              {explain.remainingDays}日で割ると、今日の上限は{yen(cap)}です。
              {over > 0
                ? `今日は${yen(explain.spentTodayYen)}使ったので、${yen(over)}超えています。`
                : `今日は${yen(explain.spentTodayYen)}なので、あと${yen(cap - explain.spentTodayYen)}使えます。`}
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
        </div>
      ) : null}
    </>
  );
}
