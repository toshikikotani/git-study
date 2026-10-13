'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { formatYen } from '@/domain/money';
import {
  SHORT_WINDOW,
  LONG_WINDOW,
  buildDailySeries,
  computeTrend,
  directionLabel,
  type TrendDirection,
} from '@/domain/trend';
import { addDays, todayJst } from '@/lib/date';

const LOOKBACK_DAYS = 60;

function directionColor(direction: TrendDirection): string {
  switch (direction) {
    case 'increasing':
      return 'var(--state-caution)';
    case 'decreasing':
      return 'var(--state-ok)';
    case 'stable':
      return 'var(--ink-secondary)';
  }
}

export function SpendingTrendChart({
  daySpend,
}: {
  /** 日次の実績支出（正の数） */
  daySpend: Readonly<Record<string, number>>;
}) {
  const today = todayJst();
  const from = addDays(today, -(LOOKBACK_DAYS - 1));

  const result = useMemo(() => {
    const daily = buildDailySeries(daySpend, from, today);
    return computeTrend(daily);
  }, [daySpend, from, today]);

  if (result.points.length < LONG_WINDOW) {
    return (
      <section
        className="glass rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          最近の支出の勢い
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          判定に必要なデータがまだ足りません（最低{LONG_WINDOW}日分）。
        </p>
      </section>
    );
  }

  const chartData = result.points.map((p) => ({
    date: p.date.slice(5), // MM-DD
    short: p.shortMa,
    long: p.longMa,
    spent: p.spentYen,
  }));

  const dir = result.direction;
  const color = directionColor(dir);

  return (
    <section
      className="glass space-y-3 rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      aria-label="最近の支出の勢い"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          最近の支出の勢い
        </h2>
        <span
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={{ background: 'var(--plane)', color }}
        >
          {directionLabel(dir)}
        </span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        短期（{SHORT_WINDOW}日）移動平均が長期（{LONG_WINDOW}日）移動平均を上回っていれば増加傾向、下回っていれば減少傾向。
      </p>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--ink) 12%, transparent)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--ink-muted)' }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--ink-muted)' }}
              tickFormatter={(v) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toString())}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--hairline)',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value: number | null, name: string) => {
                if (value === null) return ['—', name];
                const label =
                  name === 'short'
                    ? `${SHORT_WINDOW}日平均`
                    : name === 'long'
                      ? `${LONG_WINDOW}日平均`
                      : 'その日';
                return [formatYen(Math.round(value), { sign: 'never' }), label];
              }}
            />
            <Line
              type="monotone"
              dataKey="short"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={false}
              connectNulls
              name="short"
            />
            <Line
              type="monotone"
              dataKey="long"
              stroke="var(--ink-secondary)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              name="long"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular" style={{ color: 'var(--ink-secondary)' }}>
        <span>
          {SHORT_WINDOW}日平均:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {result.latestShortMa !== null ? formatYen(Math.round(result.latestShortMa), { sign: 'never' }) : '—'}
          </strong>
        </span>
        <span>
          {LONG_WINDOW}日平均:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {result.latestLongMa !== null ? formatYen(Math.round(result.latestLongMa), { sign: 'never' }) : '—'}
          </strong>
        </span>
      </div>
    </section>
  );
}
