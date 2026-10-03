'use client';

import { formatYen } from '@/domain/money';
import type { GenreForecast } from '@/domain/report-forecast';

function axisYen(yen: number): string {
  if (yen >= 10000)
    return `${(yen / 10000)
      .toFixed(yen >= 100000 ? 0 : 2)
      .replace(/0$/, '')
      .replace(/\.$/, '')}万`;
  return `${yen.toLocaleString('ja-JP')}`;
}

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
  if (!selected || selected.history.length === 0) return null;
  const points = selected.history;
  const last = points[points.length - 1]!;
  const max = Math.max(last.yen, selected.pointYen, selected.highYen ?? 0, 1);
  const x = (index: number) => (index / points.length) * 100;
  const y = (yen: number) => 100 - (yen / max) * 100;
  const actual = points.map((point, index) => `${x(index)},${y(point.yen)}`).join(' ');
  const band =
    selected.showBand && selected.lowYen !== null && selected.highYen !== null
      ? `${x(points.length - 1)},${y(selected.highYen)} ${x(points.length)},${y(selected.highYen)} ${x(points.length)},${y(selected.lowYen)} ${x(points.length - 1)},${y(selected.lowYen)}`
      : null;
  const delta = last.yen - selected.pointYen;
  const deltaText =
    delta === 0
      ? '予測と同じ'
      : delta > 0
        ? `予測より${formatYen(delta, { sign: 'never' })}多い`
        : `予測より${formatYen(-delta, { sign: 'never' })}少ない`;
  return (
    <section
      aria-label="支出の統計予測"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {selected.genreName}
      </p>
      <div className="relative mt-3 h-40" style={{ marginRight: 52 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img">
          {band ? <polygon points={band} fill="var(--income)" opacity="0.18" /> : null}
          <polyline
            points={actual}
            fill="none"
            stroke="var(--income)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(points.length - 1)}
            y1={y(last.yen)}
            x2={x(points.length)}
            y2={y(selected.pointYen)}
            stroke="var(--income)"
            strokeWidth="1.6"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute size-2 rounded-full"
          style={{
            left: `${x(points.length - 1)}%`,
            top: `${y(last.yen)}%`,
            transform: 'translate(-50%, -50%)',
            background: 'var(--income)',
            boxShadow: '0 0 0 2px var(--surface)',
          }}
        />
        <span
          className="absolute text-[11px] whitespace-nowrap"
          style={{
            left: `${Math.min(x(points.length - 1) + 3, 62)}%`,
            top: `${y(last.yen)}%`,
            color: 'var(--ink-secondary)',
          }}
        >
          {deltaText}
        </span>
        <div
          className="pointer-events-none absolute inset-y-0 -right-14 w-12 text-right text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span className="absolute top-0 right-0">{axisYen(max)}</span>
          <span className="absolute top-1/2 right-0">{axisYen(max / 2)}</span>
        </div>
      </div>
      <div
        className="tabular mt-1 flex justify-between text-xs"
        style={{ color: 'var(--ink-secondary)', marginRight: 52 }}
      >
        <span>{points[0]?.monthKey.slice(5)}</span>
        <span>{last.monthKey.slice(5)}</span>
        <span>予測</span>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        実線は完了月の実績、点線は次の点予測。帯は90%区間。
        {selected.showBand
          ? ` 隠し検証は${selected.holdoutCount}回中${selected.hitCount}回。`
          : ' 区間は検証が足りないので出ていない。'}
      </p>
      {overallYen !== null ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--ink)' }}>
          全体の着地は {formatYen(overallYen, { sign: 'never' })}。
          {overallUsesDirect ? '全体の直接予測。' : 'ジャンルの合計。'}
        </p>
      ) : null}
    </section>
  );
}
