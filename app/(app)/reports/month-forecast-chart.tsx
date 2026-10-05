'use client';

import { formatYen } from '@/domain/money';

export function MonthForecastChart({
  months,
  currentYen,
  p10,
  p50,
  p90,
  budgetYen,
}: {
  months: readonly { label: string; yen: number }[];
  currentYen: number;
  p10: number;
  p50: number;
  p90: number;
  budgetYen: number | null;
}) {
  const points = [...months, { label: '今月', yen: currentYen }, { label: '着地', yen: p50 }];
  const max = Math.max(p90, budgetYen ?? 0, ...points.map((point) => point.yen), 1);
  const x = (index: number) => (index / Math.max(points.length - 1, 1)) * 100;
  const y = (yen: number) => 100 - (yen / max) * 100;
  const actual = points
    .slice(0, -1)
    .map((point, index) => `${x(index)},${y(point.yen)}`)
    .join(' ');
  const last = points.length - 2;
  const band = `${x(last)},${y(p90)} ${x(last + 1)},${y(p90)} ${x(last + 1)},${y(p10)} ${x(last)},${y(p10)}`;
  return (
    <section
      aria-label="全支出の月次予想"
      className="rounded-[22px] px-4 py-4"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        全支出
      </p>
      <div className="relative mt-3 h-40" style={{ marginRight: 48 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img">
          {budgetYen ? (
            <line
              x1="0"
              y1={y(budgetYen)}
              x2="100"
              y2={y(budgetYen)}
              stroke="var(--ink)"
              strokeWidth="1"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <polygon points={band} fill="var(--income)" opacity="0.22" />
          <polyline
            points={actual}
            fill="none"
            stroke="var(--income)"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(last)}
            y1={y(currentYen)}
            x2={x(last + 1)}
            y2={y(p50)}
            stroke="var(--income)"
            strokeWidth="1.6"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute size-2 rounded-full"
          style={{
            left: `${x(last)}%`,
            top: `${y(currentYen)}%`,
            transform: 'translate(-50%, -50%)',
            background: 'var(--income)',
            boxShadow: '0 0 0 2px var(--surface)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 -right-12 w-11 text-right text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span className="absolute top-0 right-0">{axisYen(max)}</span>
          <span className="absolute top-1/2 right-0">{axisYen(max / 2)}</span>
        </div>
      </div>
      <div
        className="tabular mt-1 flex justify-between text-xs"
        style={{ color: 'var(--ink-secondary)', marginRight: 48 }}
      >
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        実線は月の全支出、点線は今月の着地。帯は10回中8回の範囲。
        {budgetYen ? ` 点線の水平は目標 ${formatYen(budgetYen, { sign: 'never' })}。` : ''}
      </p>
    </section>
  );
}

function axisYen(yen: number): string {
  if (yen >= 10000) return `${(yen / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return yen.toLocaleString('ja-JP');
}
