'use client';

import { formatYen } from '@/domain/money';
import type { GenreForecast } from '@/domain/report-forecast';

export function ForecastGraphic(forecast: GenreForecast) {
  const max = Math.max(forecast.meanYen, forecast.latestYen, forecast.highYen, 1);
  const bars = [
    { label: '平均', yen: forecast.meanYen },
    { label: '先月', yen: forecast.latestYen },
    { label: '点予測', yen: forecast.pointYen },
  ];
  return (
    <section
      aria-label="支出の統計予測"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {forecast.genreName}の80%予測区間
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
                background: bar.label === '点予測' ? 'var(--over)' : 'var(--ink)',
                opacity: bar.label === '平均' ? 0.35 : 1,
              }}
            />
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {bar.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        来月の点予測は {formatYen(forecast.pointYen, { sign: 'never' })}。80%区間は{' '}
        {formatYen(forecast.lowYen, { sign: 'never' })} から{' '}
        {formatYen(forecast.highYen, { sign: 'never' })}。傾きは月 {formatYen(forecast.slopeYen)}
        、ばらつきは {formatYen(forecast.sdYen, { sign: 'never' })}。
      </p>
    </section>
  );
}
