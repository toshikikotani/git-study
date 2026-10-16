'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updatePlanPeriodAction } from './actions';

/** 予算の期間(はじまり・おわり)を直す。 */
export function PlanPeriodForm({
  planId,
  periodStart,
  periodEnd,
}: {
  planId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const router = useRouter();
  const [start, setStart] = useState(periodStart);
  const [end, setEnd] = useState(periodEnd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updatePlanPeriodAction(planId, start, end);
    setSaving(false);
    if (result.error) setError(result.error);
    else router.refresh();
  };

  const field = 'min-h-11 rounded-lg px-3 text-base';
  const fieldStyle = { background: 'var(--plane)', color: 'var(--ink)' };
  return (
    <div className="space-y-3">
      <label className="flex min-h-11 items-center justify-between gap-3 text-base">
        <span style={{ color: 'var(--ink)' }}>はじまり</span>
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className={field}
          style={fieldStyle}
        />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 text-base">
        <span style={{ color: 'var(--ink)' }}>おわり</span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className={field}
          style={fieldStyle}
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--state-caution)' }}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || (start === periodStart && end === periodEnd)}
        className="min-h-11 w-full rounded-full text-sm font-semibold disabled:opacity-40"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        {saving ? '保存しています' : '期間を保存'}
      </button>
    </div>
  );
}
