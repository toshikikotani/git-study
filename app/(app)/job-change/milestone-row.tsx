'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import { formatDateJa } from '@/lib/date';
import type { Milestone, MilestoneStatus } from '@/features/job-change/store';
import { deleteMilestoneAction, setMilestoneStatusAction } from './actions';

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  todo: '未着手',
  doing: '進行中',
  done: '完了',
  dropped: '見送り',
};

/**
 * チェックリストの1件(P3-2)。状態変更・削除は1タップ(`/rules` の
 * RuleRow と同じ考え方)。
 */
export function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ error: string | null }>) => {
    setPending(true);
    const result = await action();
    setError(result.error);
    setPending(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-medium"
            style={{
              color: milestone.status === 'done' ? 'var(--ink-muted)' : 'var(--ink)',
              textDecoration: milestone.status === 'done' ? 'line-through' : 'none',
            }}
          >
            {milestone.title}
          </p>
          {milestone.dueOn ? (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              期限 {formatDateJa(milestone.dueOn)}
            </p>
          ) : null}
          {milestone.note ? (
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {milestone.note}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <select
            value={milestone.status}
            disabled={pending}
            onChange={(e) => void run(() => setMilestoneStatusAction(milestone.id, e.target.value))}
            className="rounded-full px-2 py-1 text-xs"
            style={{
              background: 'var(--plane)',
              color: 'var(--ink-secondary)',
              border: '1px solid var(--hairline)',
            }}
          >
            {(Object.keys(STATUS_LABEL) as MilestoneStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => deleteMilestoneAction(milestone.id))}
            className="text-xs font-semibold disabled:opacity-40"
            style={{ color: 'var(--over)' }}
          >
            削除
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
