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
  label: string;
  detail: string;
};

export function ForecastReport({
  summary,
  proposedTotalYen,
  rows,
  onApply,
}: {
  summary: string;
  proposedTotalYen: number | null;
  rows: readonly ForecastRow[];
  onApply: (row: ForecastRow) => void;
}) {
  return (
    <section className="mt-3 space-y-3" aria-label="着地の分析">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        {summary}
      </p>
      {proposedTotalYen !== null ? (
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          着地から見た総額 {formatYen(proposedTotalYen, { sign: 'never' })}
        </p>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.genreId}
            className="rounded-2xl px-3 py-3"
            style={{
              background: 'rgba(255, 255, 255, 0.38)',
              border: '1px solid rgba(255, 255, 255, 0.72)',
            }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {row.genreName}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              すでに {formatYen(row.spentYen, { sign: 'never' })}
              {row.scheduledYen > 0
                ? ` ・ 予定 ${formatYen(row.scheduledYen, { sign: 'never' })}`
                : ' ・ 予定なし'}
              {row.medianYen !== null
                ? ` ・ 着地 ${formatYen(row.medianYen, { sign: 'never' })}`
                : ''}
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {row.detail}
            </p>
            {row.medianYen !== null ? (
              <button
                type="button"
                className="mt-2 min-h-11 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
                onClick={() => onApply(row)}
              >
                この着地を目標にする
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
