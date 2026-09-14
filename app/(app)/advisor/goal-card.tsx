'use client';

/**
 * 目標1件のカード(本人発案)。進捗の更新・見送りをここで行う。
 *
 * 進捗額は自動計算しない(domain/goals.ts のコメント参照)ため、
 * 本人が更新するための小さな入力欄を常設する。
 */

import { useState, useTransition } from 'react';

import { goalProgressRatio } from '@/domain/goals';
import { formatYen } from '@/domain/money';
import type { Goal } from '@/features/goals/store';
import { formatDateJa } from '@/lib/date';
import { abandonGoalAction, updateGoalProgressAction } from './actions';

export function GoalCard({ goal }: { goal: Goal }) {
  const [amountInput, setAmountInput] = useState(String(goal.currentAmountYen));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ratio = goalProgressRatio(goal);
  const percent = ratio === null ? null : Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

  function handleUpdateProgress() {
    const amount = Number(amountInput.replace(/[,\s]/g, ''));
    if (!Number.isInteger(amount) || amount < 0) {
      setError('0円以上の整数で入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateGoalProgressAction(goal.id, amount);
      if (result.error) setError(result.error);
    });
  }

  function handleAbandon() {
    setError(null);
    startTransition(async () => {
      const result = await abandonGoalAction(goal.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {goal.title}
        </span>
        {goal.targetDate ? (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            期限 {formatDateJa(goal.targetDate)}
          </span>
        ) : null}
      </div>

      {goal.targetAmountYen !== null ? (
        <>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--accent-track)' }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%`, background: 'var(--accent)' }}
            />
          </div>
          <p className="tabular mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {formatYen(goal.currentAmountYen)} / {formatYen(goal.targetAmountYen)}({percent}%)
          </p>
        </>
      ) : (
        <p className="tabular mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          現在 {formatYen(goal.currentAmountYen)}
        </p>
      )}

      {goal.note ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {goal.note}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          className="w-28 rounded-full px-3 py-1.5 text-xs"
          style={{ background: 'var(--plane)', color: 'var(--ink)' }}
          aria-label="進捗額(円)"
        />
        <button
          type="button"
          onClick={handleUpdateProgress}
          disabled={isPending}
          className="rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
        >
          進捗を更新
        </button>
        <button
          type="button"
          onClick={handleAbandon}
          disabled={isPending}
          className="ml-auto text-xs disabled:opacity-50"
          style={{ color: 'var(--ink-muted)' }}
        >
          見送る
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
