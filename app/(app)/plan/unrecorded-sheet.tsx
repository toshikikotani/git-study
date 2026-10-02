'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { formatYen } from '@/domain/money';
import { addGoalGenreAction, excludeGoalGenreAction } from './membership-actions';

export type UnrecordedRow = {
  genreId: string | null;
  genreName: string;
  spentYen: number;
};

/** 期間中に発生したのに目標行が無い支出。折りたたまない。 */
export function UnrecordedSheet({ planId, rows }: { planId: string; rows: readonly UnrecordedRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function add(genreId: string, yen: number) {
    setPending(genreId);
    setError(null);
    const result = await addGoalGenreAction(planId, genreId, yen);
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
        style={{
          borderRadius: 40,
          background: 'rgba(255, 255, 255, 0.38)',
          backdropFilter: 'blur(34px) saturate(190%)',
          WebkitBackdropFilter: 'blur(34px) saturate(190%)',
          border: '1px solid rgba(255, 255, 255, 0.72)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.92), 0 10px 24px rgba(16,24,40,0.08)',
          color: 'var(--ink)',
        }}
      >
        <span>未収録の支出</span>
        <span>{rows.length}件</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className="px-2 pb-2">
          <h2 className="px-2 text-base font-semibold" style={{ color: 'var(--ink)' }}>
            目標に加える
          </h2>
          <ul className="mt-3 space-y-3">
            {rows.map((row) => (
              <li key={row.genreId ?? 'none'} className="px-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {row.genreName}
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                    この期間に {formatYen(row.spentYen, { sign: 'never' })}
                  </span>
                </p>
                {row.genreId === null ? (
                  <Link href="/spending/category/none" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                    分類する
                  </Link>
                ) : (
                  <AddRow
                    spentYen={row.spentYen}
                    busy={pending === row.genreId}
                    onAdd={(yen) => add(row.genreId!, yen)}
                  />
                )}
              </li>
            ))}
          </ul>
          {error ? <p className="mt-3 px-2 text-sm" style={{ color: 'var(--over)' }}>{error}</p> : null}
        </div>
      </BottomSheet>
    </>
  );
}

function AddRow({ spentYen, busy, onAdd }: { spentYen: number; busy: boolean; onAdd: (yen: number) => void }) {
  const [yen, setYen] = useState(String(spentYen));
  return (
    <div className="mt-1 flex items-center gap-2">
      <input
        inputMode="numeric"
        value={yen}
        onChange={(e) => setYen(e.target.value.replace(/[^0-9]/g, ''))}
        className="min-h-11 w-28 rounded-full px-3 text-sm"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        aria-label="目標額"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onAdd(Number(yen || 0))}
        className="min-h-11 rounded-full px-4 text-sm font-semibold"
        style={{ background: 'var(--ink)', color: 'var(--surface)' }}
      >
        目標に加える
      </button>
    </div>
  );
}

export function ExcludeGenreButton({ planId, genreId }: { planId: string; genreId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ml-2">
      <button
        type="button"
        className="min-h-11 text-xs font-semibold"
        style={{ color: 'var(--ink-muted)' }}
        onClick={async () => {
          const result = await excludeGoalGenreAction(planId, genreId);
          if (result.error) setError(result.error);
          else router.refresh();
        }}
      >
        数えない
      </button>
      {error ? <span className="ml-1 text-xs" style={{ color: 'var(--over)' }}>{error}</span> : null}
    </span>
  );
}
