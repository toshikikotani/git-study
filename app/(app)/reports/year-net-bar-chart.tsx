/**
 * 年のレポート:月ごとの支出・収入・収支の棒グラフ(N4)。収支はプラスと
 * マイナスで色と向きを変える。既存の年間収支サマリー(income-expense-chart.tsx、
 * 貯蓄率・月平均比較が主眼の折れ線)とはデータ(features/reports/store.ts の
 * IncomeExpenseTrend)を共有しつつ、見せ方(収支そのものを棒で見せる)が
 * 違うため別部品にした(ADR-033の「同じ考慮を複数箇所に書かない」は
 * データ取得側で満たし、可視化は目的ごとに分ける)。
 */

import { formatSignedYen } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { formatMonthJa } from '@/lib/date';
import type { IncomeExpenseTrend } from '@/features/reports/store';

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = 12;
const AXIS_Y = HEIGHT / 2;

export function YearNetBarChart({ trend }: { trend: IncomeExpenseTrend }) {
  const { rows } = trend;
  const hasAnyActivity = rows.some((row) => row.incomeYen > 0 || row.expenseYen > 0);

  if (!hasAnyActivity) return null;

  const nets = rows.map((r) => r.incomeYen - r.expenseYen);
  const maxAbs = Math.max(...nets.map((n) => Math.abs(n)), 1);
  const totalNet = nets.reduce((a, b) => a + b, 0);
  const averageNet = Math.round(totalNet / rows.length);

  const barWidth = (WIDTH - PADDING * 2) / rows.length;
  const barInnerWidth = barWidth * 0.6;

  return (
    <div
      className="glass rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          年間の収支(月ごと)
        </h2>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`月ごとの収支:${rows.map((r, i) => `${formatMonthJa(r.monthKey)} ${formatSignedYen(nets[i]!)}`).join('、')}`}
      >
        <line x1={0} y1={AXIS_Y} x2={WIDTH} y2={AXIS_Y} stroke="var(--hairline)" strokeWidth={1} />
        {rows.map((row, i) => {
          const net = nets[i]!;
          const x = PADDING + barWidth * i + (barWidth - barInnerWidth) / 2;
          const barHeight = (Math.abs(net) / maxAbs) * (AXIS_Y - PADDING);
          const y = net >= 0 ? AXIS_Y - barHeight : AXIS_Y;
          return (
            <g key={row.monthKey}>
              <rect
                x={x}
                y={y}
                width={barInnerWidth}
                height={Math.max(barHeight, 1)}
                rx={2}
                fill={net >= 0 ? 'var(--income)' : 'var(--over)'}
              >
                <title>{`${formatMonthJa(row.monthKey)}: ${formatSignedYen(net)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
          合計{' '}
          <span style={{ color: totalNet >= 0 ? 'var(--income)' : 'var(--over)' }}>
            {formatSignedYen(totalNet)}
          </span>
        </span>
        <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
          月平均{' '}
          <span style={{ color: averageNet >= 0 ? 'var(--income)' : 'var(--over)' }}>
            {formatSignedYen(averageNet)}
          </span>
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">月別の収支の表</caption>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
              <th className="p-2 text-left font-medium" style={{ color: 'var(--ink-muted)' }}>
                月
              </th>
              <th className="p-2 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
                収入
              </th>
              <th className="p-2 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
                支出
              </th>
              <th className="p-2 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
                収支
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.monthKey} style={{ borderBottom: '1px solid var(--hairline)' }}>
                <td className="p-2" style={{ color: 'var(--ink)' }}>
                  {formatMonthJa(row.monthKey)}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(row.incomeYen, { sign: 'never' })}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(row.expenseYen, { sign: 'never' })}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(row.scheduledYen, { sign: 'never' })}
                </td>
                <td
                  className="tabular p-2 text-right"
                  style={{ color: nets[i]! >= 0 ? 'var(--income)' : 'var(--over)' }}
                >
                  {formatSignedYen(nets[i]!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
