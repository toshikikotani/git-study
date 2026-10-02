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
    <section className="mt-3 space-y-3" aria-label="着地の分析">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        {summary}
      </p>
      {proposedTotalYen !== null ? (
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          着地から見た総額 {formatYen(proposedTotalYen, { sign: 'never' })}
        </p>
      ) : null}
      {onApplyAll && rows.some((row) => row.recommendedYen !== null) ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-full px-4 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--action)', color: 'var(--on-action)' }}
          disabled={applying}
          onClick={onApplyAll}
        >
          {applying ? '全部の目標を保存しています…' : '全部の目標案を保存する'}
        </button>
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
              {row.recommendedYen !== null
                ? ` ・ 目標案 ${formatYen(row.recommendedYen, { sign: 'never' })}`
                : row.medianYen !== null
                  ? ` ・ 着地 ${formatYen(row.medianYen, { sign: 'never' })}`
                  : ''}
              {row.exceedance !== null ? ` ・ 超過 ${Math.round(row.exceedance * 100)}%` : ''}
            </p>
            <p
              className="mt-2 text-sm font-semibold leading-relaxed"
              style={{ color: 'var(--ink)' }}
            >
              {row.advice}
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {row.detail}
            </p>
            {row.recommendedYen !== null ? (
              <button
                type="button"
                className="mt-2 min-h-11 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
                onClick={() => onApply(row)}
              >
                この目標案にする
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
