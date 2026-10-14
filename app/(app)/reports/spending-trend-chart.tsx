'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
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
  fixedYen = 0,
}: {
  /** 日次の実績支出（正の数・固定費を除いたもの） */
  daySpend: Readonly<Record<string, number>>;
  /** この期間の固定費合計（表示用） */
  fixedYen?: number;
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
    date: p.date.slice(5),
    short: p.shortMa,
    long: p.longMa,
    spent: p.spentYen,
    aboveAvg: p.shortMa !== null && p.spentYen > p.shortMa,
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
        棒は1日の支出（レシート単位で固定費とマークしたものは除く）。7日平均を上回った日は赤、下回った日は灰色です。
        線は平均のペース（実線=直近7日、点線=直近21日）です。
      </p>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="color-mix(in srgb, var(--ink) 12%, transparent)"
            />
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
              formatter={(value, name) => {
                const num = typeof value === 'number' ? value : null;
                if (num === null) return ['—', String(name)];
                const label =
                  name === 'short'
                    ? `${SHORT_WINDOW}日平均`
                    : name === 'long'
                      ? `${LONG_WINDOW}日平均`
                      : 'その日の支出';
                return [formatYen(Math.round(num), { sign: 'never' }), label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => {
                if (value === 'spent') return 'その日の支出';
                if (value === 'short') return `${SHORT_WINDOW}日平均`;
                if (value === 'long') return `${LONG_WINDOW}日平均`;
                return value;
              }}
            />
            <Bar dataKey="spent" radius={[2, 2, 0, 0]} name="spent">
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    entry.aboveAvg
                      ? 'color-mix(in srgb, var(--over) 75%, transparent)'
                      : 'color-mix(in srgb, var(--ink) 18%, transparent)'
                  }
                />
              ))}
            </Bar>
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span>
          {SHORT_WINDOW}日平均:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {result.latestShortMa !== null
              ? formatYen(Math.round(result.latestShortMa), { sign: 'never' })
              : '—'}
          </strong>
        </span>
        <span>
          {LONG_WINDOW}日平均:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {result.latestLongMa !== null
              ? formatYen(Math.round(result.latestLongMa), { sign: 'never' })
              : '—'}
          </strong>
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        <span className="flex items-center gap-1">
          <span
            className="inline-block size-3 rounded"
            style={{ background: 'color-mix(in srgb, var(--over) 75%, transparent)' }}
          />
          7日平均を上回った日
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block size-3 rounded"
            style={{ background: 'color-mix(in srgb, var(--ink) 18%, transparent)' }}
          />
          7日平均を下回った日
        </span>
      </div>

      {fixedYen > 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          この期間の固定費（家賃・サブスクなど）は{' '}
          <strong style={{ color: 'var(--ink)' }}>{formatYen(fixedYen, { sign: 'never' })}</strong>
          あります。上のグラフには含めていません。
        </p>
      ) : null}
    </section>
  );
}
