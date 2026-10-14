'use client';

/**
 * 頻度 × 単価のバブルチャート。
 * X軸: 月間発生頻度、Y軸: 1回あたり平均単価、大きさ: 月間合計。
 */

import { useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';
import { genreColorVar } from '@/domain/genre-style';
import { formatYen } from '@/domain/money';

export type BubblePoint = {
  genreId: string | null;
  name: string;
  frequency: number;
  avgYen: number;
  totalYen: number;
};

export function BubbleChart({ points }: { points: readonly BubblePoint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const data = points.filter((p) => p.frequency > 0 && p.totalYen > 0);

  if (data.length === 0) {
    return (
      <div
        className="glass rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          頻度と単価
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          表示する支出がありません。
        </p>
      </div>
    );
  }

  return (
    <div
      className="glass rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        頻度と単価
      </h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        横軸は月間の回数、縦軸は1回あたりの平均。大きいほど合計が多い。
      </p>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
            <XAxis
              type="number"
              dataKey="frequency"
              name="回数"
              unit="回"
              stroke="var(--ink-muted)"
              fontSize={11}
              domain={[0, 'auto']}
            />
            <YAxis
              type="number"
              dataKey="avgYen"
              name="単価"
              unit="円"
              stroke="var(--ink-muted)"
              fontSize={11}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <ZAxis type="number" dataKey="totalYen" range={[40, 200]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ payload }) => {
                if (!payload?.[0]) return null;
                const p = payload[0].payload as BubblePoint;
                return (
                  <div
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
                  >
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                      {p.name}
                    </div>
                    <div style={{ color: 'var(--ink-secondary)' }}>
                      {p.frequency}回 · 平均{formatYen(p.avgYen, { sign: 'never' })}
                    </div>
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatYen(p.totalYen, { sign: 'never' })}
                    </div>
                  </div>
                );
              }}
            />
            {data.map((p) => (
              <Scatter
                key={p.genreId ?? p.name}
                data={[p]}
                fill={genreColorVar(p.name)}
                fillOpacity={0.75}
                stroke="var(--ink)"
                strokeWidth={1}
                onClick={() => setSelected(p.genreId ?? p.name)}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {selected ? (
        <p className="mt-2 text-center text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {data.find((p) => (p.genreId ?? p.name) === selected)?.name}:{' '}
          {formatYen(data.find((p) => (p.genreId ?? p.name) === selected)?.totalYen ?? 0, {
            sign: 'never',
          })}
        </p>
      ) : null}
    </div>
  );
}
