'use client';

import { useState } from 'react';

import { approveAction } from './actions';

/** 「許可する」「やめる」。許可したら、アプリへ戻る(戻り先はサーバーが決める)。 */
export function ConsentButtons({ query, denyUrl }: { query: string; denyUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    const result = await approveAction(query).catch(() => ({ error: '許可できませんでした。' }));
    // 許可できたときはサーバーがアプリへ移すので、ここへは戻らない。
    setBusy(false);
    setError(result.error);
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void approve()}
        className="btn-primary min-h-12 w-full rounded-full text-[17px] font-semibold"
      >
        {busy ? '許可しています…' : '許可する'}
      </button>
      <a
        href={denyUrl}
        className="flex min-h-12 w-full items-center justify-center rounded-full text-[17px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        やめる
      </a>
      {error ? (
        <p role="alert" className="text-[13px]" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
