'use client';

import { formatYen } from '@/domain/money';
import type { GenreForecast } from '@/domain/report-forecast';

export function ForecastGraphic({
  genres,
  overallYen,
  overallUsesDirect,
}: {
  genres: GenreForecast[];
  overallYen: number | null;
  overallUsesDirect: boolean;
}) {
  const selected = genres[0];
  if (!selected) return null;
  const width = 320;
  const height = 140;
  const pad = 16;
  const next = selected.pointYen;
  const values = [...selected.history.map((point) => point.yen), next, selected.highYen ?? next];
  const max = Math.max(...values, 1);
  const x = (index: number) =>
    pad + (index / Math.max(selected.history.length, 1)) * (width - pad * 2);
  const y = (yen: number) => height - pad - (yen / max) * (height - pad * 2);
  const line = selected.history.map((point, index) => `${x(index)},${y(point.yen)}`).join(' ');
  const band =
    selected.showBand && selected.lowYen !== null && selected.highYen !== null
      ? `${x(selected.history.length - 1)},${y(selected.highYen)} ${x(selected.history.length)},${y(selected.highYen)} ${x(selected.history.length)},${y(selected.lowYen)} ${x(selected.history.length - 1)},${y(selected.lowYen)}`
      : null;
  return (
    <section
      aria-label="支出の統計予測"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {selected.genreName}
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img">
        {band ? <polygon points={band} fill="var(--over)" opacity="0.18" /> : null}
        <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth="2" />
        {selected.intermittent
          ? selected.history
              .filter((point) => point.yen > 0)
              .map((point, index) => (
                <circle
                  key={point.monthKey}
                  cx={x(selected.history.indexOf(point))}
                  cy={y(point.yen)}
                  r="3"
                  fill="var(--ink)"
                />
              ))
          : null}
        <line
          x1={x(selected.history.length - 1)}
          y1={y(selected.history[selected.history.length - 1]?.yen ?? 0)}
          x2={x(selected.history.length)}
          y2={y(next)}
          stroke="var(--over)"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
      </svg>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        点予測は {formatYen(selected.pointYen, { sign: 'never' })}。
        {selected.showBand && selected.lowYen !== null && selected.highYen !== null
          ? `90%区間は ${formatYen(selected.lowYen, { sign: 'never' })} から ${formatYen(selected.highYen, { sign: 'never' })}。隠し検証は ${selected.holdoutCount}回中${selected.hitCount}回。`
          : '区間は、隠し検証が足りないので出していない。'}
        {selected.scheduledYen > 0
          ? ` 予定 ${formatYen(selected.scheduledYen, { sign: 'never' })} を足している。`
          : ''}
      </p>
      {overallYen !== null ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          全体の着地は {formatYen(overallYen, { sign: 'never' })}。
          {overallUsesDirect ? 'ジャンル合計と差があるため、全体の直接予測。' : 'ジャンルの合計。'}
        </p>
      ) : null}
    </section>
  );
}
