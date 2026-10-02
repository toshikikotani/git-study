'use client';

import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { formatAxisYen } from '@/features/category/chart-layout';
import type { CumulativeChart } from '@/features/category/pace';

/**
 * 累計グラフ。軸の上限は予算。予測の帯が予算を超えても目盛りは動かさない。
 * Recharts 3 の domain で固定する。5万のような切りのよい数へ自動で伸ばさない。
 */
export function BudgetPaceChart({
  chart,
  budgetYen,
  color,
  height,
}: {
  chart: CumulativeChart;
  budgetYen: number | null;
  color: string;
  height: number;
}) {
  const domainMax = budgetYen && budgetYen > 0 ? budgetYen : chart.maxYen;
  const rows = chart.days.map((d) => ({
    label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`,
    actual: d.actualYen,
    ideal: d.idealYen,
    band: d.forecastHighYen === null ? null : Math.min(d.forecastHighYen, domainMax),
  }));

  return (
    <div className="absolute inset-0" data-chart="budget-pace">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} accessibilityLayer margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, domainMax]}
            ticks={[domainMax / 2, domainMax]}
            tickFormatter={(v: number) => formatAxisYen(v)}
            width={48}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
          />
          <Area
            dataKey="band"
            stroke="none"
            fill={color}
            fillOpacity={0.18}
            isAnimationActive={false}
            name="予測"
          />
          <Line
            dataKey="ideal"
            stroke={color}
            strokeDasharray="4 4"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
            name="理想"
            connectNulls
          />
          <Line
            dataKey="actual"
            stroke={color}
            dot={{ r: 3 }}
            strokeWidth={2}
            isAnimationActive={false}
            name="実績"
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
