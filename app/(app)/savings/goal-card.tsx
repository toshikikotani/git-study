'use client';

/**
 * 貯金目標1件のカード(ADR-077)。貯まった額は収入 − 支出から自動で数えるので、
 * ここに手入力の欄は無い。貯まったら「達成にする」、やめるなら「見送る」。
 */

import { useState, useTransition } from 'react';

import { goalOutlook, type SavingsGoalProgress } from '@/domain/savings';
import { formatYen } from '@/domain/money';
import type { Goal } from '@/features/goals/store';
import { formatDateJa, type DateOnly } from '@/lib/date';
import { abandonGoalAction, achieveGoalAction } from './actions';

export function GoalCard({
  progress,
  today,
}: {
  progress: SavingsGoalProgress<Goal>;
  today: DateOnly;
}) {
  const { goal } = progress;
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const percent =
    goal.targetAmountYen === null
      ? null
      : Math.round(Math.min(1, progress.savedYen / goal.targetAmountYen) * 100);

  function run(action: (id: string) => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action(goal.id);
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

      {goal.targetAmountYen !== null && percent !== null ? (
        <>
          <div
            className="mt-3 h-3 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--accent-track)' }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${goal.title} ${percent}%`}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%`, background: 'var(--accent)' }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
              {formatYen(progress.savedYen, { sign: 'never' })} /{' '}
              {formatYen(goal.targetAmountYen, { sign: 'never' })}
            </p>
            {progress.remainingYen !== null && progress.remainingYen > 0 ? (
              <p className="tabular text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                あと {formatYen(progress.remainingYen, { sign: 'never' })}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="tabular mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          いま {formatYen(progress.savedYen, { sign: 'never' })}
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {goalOutlook(progress, today)}
      </p>

      {goal.note ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {goal.note}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        {progress.reached ? (
          <button
            type="button"
            onClick={() => run(achieveGoalAction)}
            disabled={isPending}
            className="rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
          >
            達成にする
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => run(abandonGoalAction)}
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
