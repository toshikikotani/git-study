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
  LabelList,
  type LabelProps,
} from 'recharts';
import { useGenreOverrides } from '@/components/ui/genre-style-context';
import { genreSwatch } from '@/domain/genre-style';
import { formatCompactYen, formatYen } from '@/domain/money';

export type BubblePoint = {
  genreId: string | null;
  name: string;
  frequency: number;
  avgYen: number;
  totalYen: number;
};

const keyOf = (p: BubblePoint) => p.genreId ?? p.name;

/**
 * 名前を出す円を決める。合計の大きい順に置き、すでに名前を出した円と近いものは名前を省く
 * (原点の近くに小さいカテゴリが集まると、名前どうしが重なって読めなかった)。省いた円は押すと名前が出る。
 */
export function labeledBubbles(data: readonly BubblePoint[]): ReadonlySet<string> {
  const xMax = Math.max(...data.map((p) => p.frequency), 1);
  const yMax = Math.max(...data.map((p) => p.avgYen), 1);
  const placed: { x: number; y: number }[] = [];
  const out = new Set<string>();
  for (const p of [...data].sort((a, b) => b.totalYen - a.totalYen)) {
    const x = p.frequency / xMax;
    const y = p.avgYen / yMax;
    if (placed.every((q) => Math.abs(q.x - x) > 0.24 || Math.abs(q.y - y) > 0.12)) {
      out.add(keyOf(p));
      placed.push({ x, y });
    }
  }
  return out;
}

export function BubbleChart({ points }: { points: readonly BubblePoint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const overrides = useGenreOverrides();
  const data = points.filter((p) => p.frequency > 0 && p.totalYen > 0);
  const labeled = labeledBubbles(data);
  const xMax = Math.max(...data.map((p) => p.frequency), 1);

  if (data.length === 0) {
    return (
      <div
        className="glass rounded-2xl p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          回数と1回の金額
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          表示する支出がありません。
        </p>
      </div>
    );
  }

  return (
    <div
      className="glass rounded-2xl p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        回数と1回の金額
      </h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        右ほど回数が多く、上ほど1回が高い。円の大きさは合計です。
        {labeled.size < data.length ? '名前が重なる円は、押すと名前が出ます。' : ''}
      </p>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 0 }}>
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
              tickFormatter={(v: number) => formatCompactYen(v)}
            />
            <ZAxis type="number" dataKey="totalYen" range={[80, 280]} />
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
                key={keyOf(p)}
                data={[p]}
                fill={genreSwatch(p.genreId === null ? null : p.name, overrides[p.name])}
                fillOpacity={0.75}
                stroke="var(--ink)"
                strokeWidth={1}
                onClick={() => setSelected(keyOf(p))}
              >
                {labeled.has(keyOf(p)) ? (
                  <LabelList
                    dataKey="name"
                    position="bottom"
                    fontSize={11}
                    fill="var(--ink-secondary)"
                    offset={8}
                    content={(props: LabelProps) => {
                      const x = Number(props.x ?? 0);
                      const y = Number(props.y ?? 0);
                      // 縦軸の近くの円は、名前を右へ伸ばす(軸の目盛りに重ねない)。
                      const nearAxis = p.frequency / xMax < 0.15;
                      return (
                        <text
                          x={nearAxis ? x - 6 : x}
                          y={y + 20}
                          textAnchor={nearAxis ? 'start' : 'middle'}
                          fontSize={11}
                          fill="var(--ink-secondary)"
                        >
                          {props.value}
                        </text>
                      );
                    }}
                  />
                ) : null}
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {selected ? (
        <p className="mt-2 text-center text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {data.find((p) => keyOf(p) === selected)?.name}:{' '}
          {formatYen(data.find((p) => keyOf(p) === selected)?.totalYen ?? 0, {
            sign: 'never',
          })}
        </p>
      ) : null}
    </div>
  );
}
