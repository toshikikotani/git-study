import { formatYen } from '@/domain/money';
import { formatMonthJa } from '@/lib/date';
import { savingsRateOf } from '@/domain/spending';
import type { IncomeExpenseTrend } from '@/features/reports/store';

/**
 * 年間収支サマリー(直近12ヶ月の収入・支出・貯蓄率、分析系拡充、本人発案)。
 *
 * ── なぜ12ヶ月か ──────────────────────────────────────────────
 * カテゴリ別支出推移(P6-2)は直近6ヶ月だが、収支・貯蓄率は季節性(賞与月・
 * 年末年始の増加など)が出るまでにもう少し幅が要るため12ヶ月にした。
 *
 * ── 色について ────────────────────────────────────────────────
 * net-worth-chart.tsx と同じく、本アプリが既に予約している役割の色を使う
 * (収入=var(--income)、支出=var(--over))。貯蓄率(%)は金額(円)と単位が
 * 違うため同じ軸には乗せない(dataviz「1つのグラフは1つの軸」)。表と
 * 直接ラベルでのみ示す。
 */
const WIDTH = 600;
const HEIGHT = 160;
const PADDING = 12;

export function IncomeExpenseChart({ trend }: { trend: IncomeExpenseTrend }) {
  const { monthKeys, rows } = trend;
  const hasAnyActivity = rows.some((row) => row.incomeYen > 0 || row.expenseYen > 0);

  if (!hasAnyActivity) {
    return (
      <div
        className="rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          年間収支サマリー
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          直近12ヶ月に収支の記録がありません。
        </p>
      </div>
    );
  }

  const maxYen = Math.max(...rows.flatMap((r) => [r.incomeYen, r.expenseYen]), 1);
  const stepX = rows.length > 1 ? (WIDTH - PADDING * 2) / (rows.length - 1) : 0;

  function toXY(index: number, valueYen: number): { x: number; y: number } {
    const x = rows.length > 1 ? PADDING + stepX * index : WIDTH / 2;
    const y = HEIGHT - PADDING - (valueYen / maxYen) * (HEIGHT - PADDING * 2);
    return { x, y };
  }

  function linePath(values: readonly number[]): string {
    return values
      .map((v, i) => {
        const { x, y } = toXY(i, v);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  }

  const latest = rows[rows.length - 1]!;
  const latestRate = savingsRateOf(latest);

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          年間収支サマリー
        </h2>
        <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatMonthJa(monthKeys[monthKeys.length - 1]!)}の貯蓄率{' '}
          {latestRate === null ? '—' : `${Math.round(latestRate * 100)}%`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`${formatMonthJa(monthKeys[monthKeys.length - 1]!)}時点:収入${formatYen(latest.incomeYen)}、支出${formatYen(latest.expenseYen)}`}
      >
        <path
          d={linePath(rows.map((r) => r.incomeYen))}
          fill="none"
          stroke="var(--income)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <path
          d={linePath(rows.map((r) => r.expenseYen))}
          fill="none"
          stroke="var(--over)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {rows.map((row, i) => {
          const incomePoint = toXY(i, row.incomeYen);
          const expensePoint = toXY(i, row.expenseYen);
          return (
            <g key={row.monthKey}>
              <circle cx={incomePoint.x} cy={incomePoint.y} r={3} fill="var(--income)">
                <title>{`${formatMonthJa(row.monthKey)}: 収入 ${formatYen(row.incomeYen)}`}</title>
              </circle>
              <circle cx={expensePoint.x} cy={expensePoint.y} r={3} fill="var(--over)">
                <title>{`${formatMonthJa(row.monthKey)}: 支出 ${formatYen(row.expenseYen)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Legend color="var(--income)" label={`収入 ${formatYen(latest.incomeYen)}`} />
        <Legend color="var(--over)" label={`支出 ${formatYen(latest.expenseYen)}`} />
      </div>

      <IncomeExpenseTable trend={trend} />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
    </span>
  );
}

/** アクセシビリティ用の表(dataviz: table view は必ず用意する)。 */
function IncomeExpenseTable({ trend }: { trend: IncomeExpenseTrend }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">月別の収入・支出・貯蓄率の表</caption>
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
              貯蓄率
            </th>
          </tr>
        </thead>
        <tbody>
          {trend.rows.map((row) => {
            const rate = savingsRateOf(row);
            return (
              <tr key={row.monthKey} style={{ borderBottom: '1px solid var(--hairline)' }}>
                <td className="p-2" style={{ color: 'var(--ink)' }}>
                  {formatMonthJa(row.monthKey)}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(row.incomeYen)}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {formatYen(row.expenseYen)}
                </td>
                <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                  {rate === null ? '—' : `${Math.round(rate * 100)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
