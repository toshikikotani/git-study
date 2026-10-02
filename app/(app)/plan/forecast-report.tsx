'use client';

import { formatYen } from '@/domain/money';

export type ForecastRow = {
  genreId: string;
  genreName: string;
  spentYen: number;
  scheduledYen: number;
  medianYen: number | null;
  lowYen: number | null;
  highYen: number | null;
  recommendedYen: number | null;
  exceedance: number | null;
  label: string;
  advice: string;
  detail: string;
};

function lead(advice: string): string {
  const parts = advice
    .split('。')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, 2).join('。') + (parts.length > 0 ? '。' : '');
}

export function ForecastReport({
  summary,
  proposedTotalYen,
  rows,
  onApply,
  onApplyAll,
  applying = false,
}: {
  summary: string;
  proposedTotalYen: number | null;
  rows: readonly ForecastRow[];
  onApply: (row: ForecastRow) => void;
  onApplyAll?: () => void;
  applying?: boolean;
}) {
  return (
    <section className="mt-3 space-y-4" aria-label="抑えてほしい額">
      <div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          抑えてほしい額
        </p>
        <p
          className="tabular mt-1 text-4xl font-semibold tracking-[-0.04em]"
          style={{ color: 'var(--ink)' }}
        >
          {proposedTotalYen === null ? '—' : formatYen(proposedTotalYen, { sign: 'never' })}
        </p>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {summary}
        </p>
      </div>
      {onApplyAll && rows.some((row) => row.recommendedYen !== null) ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-full px-4 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          disabled={applying}
          onClick={onApplyAll}
        >
          {applying ? '保存しています' : 'この額にする'}
        </button>
      ) : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row.genreId}
            className="rounded-[22px] px-4 py-4"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
          >
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {row.genreName}
            </p>
            <p
              className="tabular mt-1 text-3xl font-semibold tracking-[-0.04em]"
              style={{ color: 'var(--ink)' }}
            >
              {row.recommendedYen === null ? '—' : formatYen(row.recommendedYen, { sign: 'never' })}
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              {lead(row.advice)}
            </p>
            <details className="mt-2">
              <summary
                className="min-h-11 cursor-pointer text-xs"
                style={{ color: 'var(--ink-muted)' }}
              >
                根拠
              </summary>
              <p className="pb-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                {row.detail}
              </p>
            </details>
            {row.recommendedYen !== null ? (
              <button
                type="button"
                className="min-h-11 text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
                onClick={() => onApply(row)}
              >
                この額にする
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
