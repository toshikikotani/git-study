'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deletePlanAction } from './actions';

export function DeletePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await deletePlanAction(planId);
          setBusy(false);
          if (result.error !== null) setError(result.error);
          else router.refresh();
        }}
        className="text-xs font-semibold disabled:opacity-40"
        style={{ color: 'var(--ink-muted)' }}
      >
        {busy ? '削除しています…' : 'この目標を削除する'}
      </button>
      {error ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
