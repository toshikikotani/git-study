'use client';

import { useEffect } from 'react';

import { dismissUndo, expireUndo, runUndo, useUndoEntries } from '@/lib/undo';

/**
 * 画面下の「元に戻す」トースト。タブバーとぶつからない高さに出す。
 * 5秒たつと消える。戻せなかったときは理由を出し、自動では消さない(閉じるで消す)。
 */
export function UndoToastHost() {
  const entries = useUndoEntries();

  useEffect(() => {
    if (entries.length === 0) return;
    const timer = window.setInterval(() => expireUndo(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [entries.length]);

  const entry = entries[entries.length - 1];
  if (!entry) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl px-4 py-2"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 112px)',
        background: 'var(--ink)',
        color: 'var(--surface)',
        boxShadow: 'var(--glass-shadow-float)',
      }}
    >
      <span className="min-w-0 text-sm">{entry.error ?? entry.message}</span>
      <span className="flex shrink-0 items-center">
        {entry.status !== 'failed' ? (
          <button
            type="button"
            onClick={() => void runUndo(entry.id)}
            disabled={entry.status === 'undoing'}
            className="min-h-11 px-3 text-sm font-semibold underline disabled:opacity-50"
          >
            {entry.status === 'undoing' ? '戻しています…' : '元に戻す'}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => dismissUndo(entry.id)}
          className="min-h-11 min-w-11 text-base"
        >
          ×
        </button>
      </span>
    </div>
  );
}
