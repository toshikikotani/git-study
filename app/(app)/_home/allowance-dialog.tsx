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
};

function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

/** 今日の上限の内訳。見通しへは飛ばさず、この場で棒グラフを出す。 */
export function AllowanceDialog({ explain }: { explain: AllowanceExplain }) {
  const [open, setOpen] = useState(false);
  const spentBefore = Math.max(0, explain.spentYen - explain.spentTodayYen);
  const leftBudget = explain.budgetYen - spentBefore;
  const cap = explain.capYen;
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
  const probText = prob !== null && prob !== undefined
    ? prob >= 0.995 ? '99%以上' : `${Math.round(prob * 100)}%`
    : null;
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
            平日は少なめ、休日は多めの重みで、残り{explain.remainingDays}
            日の全部の見込みが予算内に収まる額です。
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
            残りは{yen(leftBudget)}
            。平日と休日の重みで、予算内に収まる見込みが最高になる今日の上限は{yen(cap)}です。
            {over > 0
              ? `今日は${yen(explain.spentTodayYen)}使ったので、${yen(over)}超えています。`
              : `今日は${yen(explain.spentTodayYen)}なので、あと${yen(cap - explain.spentTodayYen)}使えます。`}
          </p>
          {probText !== null ? (
            <div
              className="rounded-2xl px-3 py-2"
              style={{ background: 'var(--plane)' }}
            >
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
            計算方法: 予算から今までの支出を引い、残りの日数で割った額を基準に、平日は少なめ・休日は多めの重みをかけて今日の上限を決めています。
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
