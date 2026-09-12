'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { RescuedEmail } from '@/features/import/rescue-store';
import { deleteRescuedEmailAction } from './actions';

const SOURCE_LABEL: Record<RescuedEmail['source'], string> = {
  gmail: 'Gmail自動取得',
  manual: 'メール貼り付け',
  csv: 'CSV',
  api: 'API',
};

/** AI救済メールのサンプル1件(T-11)。辞書に足す語を見つけるための表示。 */
export function RescuedEmailRow({ email }: { email: RescuedEmail }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const onDelete = async () => {
    setPending(true);
    const result = await deleteRescuedEmailAction(email.id);
    setError(result.error);
    setPending(false);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {email.subject ?? '(件名なし)'}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {SOURCE_LABEL[email.source]} ・{' '}
            {email.extractedCount > 0 ? `AIが${email.extractedCount}件読み取り` : 'AIも読み取れず'}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => void onDelete()}
          className="shrink-0 text-xs font-semibold disabled:opacity-40"
          style={{ color: 'var(--over)' }}
        >
          削除
        </button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-xs font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        {expanded ? '本文を隠す' : '本文を見る'}
      </button>
      {expanded ? (
        <pre
          className="mt-2 max-h-64 overflow-auto rounded-xl p-3 text-xs whitespace-pre-wrap"
          style={{ background: 'var(--plane)', color: 'var(--ink-secondary)' }}
        >
          {email.body}
        </pre>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
