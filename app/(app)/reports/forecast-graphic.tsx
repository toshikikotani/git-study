'use client';

import { formatYen } from '@/domain/money';

export function ForecastGraphic({
  genreName,
  priorYen,
  previousYen,
  saveYen,
}: {
  genreName: string;
  priorYen: number;
  previousYen: number;
  saveYen: number;
}) {
  const forecastYen = previousYen + Math.max(saveYen, 0);
  const max = Math.max(priorYen, previousYen, forecastYen, 1);
  const bars = [
    { label: '先々月', yen: priorYen },
    { label: '先月', yen: previousYen },
    { label: 'このまま', yen: forecastYen },
  ];
  return (
    <section
      aria-label="支出の予想"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {genreName}の予想
      </p>
      <div className="mt-4 flex h-28 items-end gap-3">
        {bars.map((bar) => (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="tabular text-xs" style={{ color: 'var(--ink)' }}>
              {formatYen(bar.yen, { sign: 'never' })}
            </span>
            <div
              className="w-full rounded-t-xl"
              style={{
                height: `${Math.max(8, (bar.yen / max) * 100)}%`,
                background: bar.label === 'このまま' ? 'var(--over)' : 'var(--ink)',
                opacity: bar.label === '先々月' ? 0.35 : 1,
              }}
            />
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {bar.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        このままだと {formatYen(forecastYen, { sign: 'never' })} まで増える。先々月の額に抑えると、
        {formatYen(saveYen, { sign: 'never' })} 残る。
      </p>
    </section>
  );
}
