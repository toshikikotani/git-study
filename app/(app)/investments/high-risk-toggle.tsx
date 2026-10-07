'use client';

import { useState, useTransition } from 'react';

import { setHighRiskAction } from './actions';

/** 高リスク枠を使うかの切り替え(ADR-081。本人の判断で決める)。 */
export function HighRiskToggle({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setHighRiskAction(!enabled);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50"
        style={{ background: 'var(--plane)', color: 'var(--accent)' }}
      >
        {enabled ? '高リスク枠を使わない' : '高リスク枠を使う'}
      </button>
      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
