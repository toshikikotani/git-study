'use client';

import { useState, useTransition } from 'react';

import { acknowledgeAllAction } from './actions';

export function MarkReadButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acknowledgeAllAction();
            setError(result.error);
          })
        }
        className="min-h-11 rounded-full px-4 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
      >
        {pending ? '既読にしています…' : 'すべて既読にする'}
      </button>
      {error ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--state-over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
