import { formatYen } from '@/domain/money';
import type { NetWorthPoint } from '@/features/net-worth/store';

/**
 * 資産推移(貯金 + 投資評価額)のグラフ(P6-3。ADR-080 で残債から貯金に)。
 *
 * ── 色について ──────────────────────────────────────────────
 * カテゴリと違い、この2本は本アプリが既に予約している役割の色をそのまま使う
 * (貯金=var(--accent)、投資評価額=var(--income)「収入・資産」)。
 * 色だけに頼らず凡例・直接ラベルに必ず文字と数値を添える。
 *
 * ── 記録が無い間 ────────────────────────────────────────────
 * net_worth_snapshots は月末にしか増えない。記録が本番へ反映される前
 * (TASKS.md のブロック事項参照)は空配列のままなので、その間は空状態を出す。
 */
const WIDTH = 600;
const HEIGHT = 160;
const PADDING = 12;

export function NetWorthChart({ points }: { points: readonly NetWorthPoint[] }) {
  if (points.length === 0) {
    return (
      <div
        className="rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          資産推移
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          資産推移の記録はまだありません。月末になると自動で記録が始まります。
        </p>
      </div>
    );
  }

  const maxYen = Math.max(...points.flatMap((p) => [p.savingsYen, p.investmentValueYen]), 1);
  const stepX = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;

  function toXY(index: number, valueYen: number): { x: number; y: number } {
    const x = points.length > 1 ? PADDING + stepX * index : WIDTH / 2;
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

  const latest = points[points.length - 1]!;

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        資産推移
      </h2>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`貯金${formatYen(latest.savingsYen)}、投資評価額${formatYen(latest.investmentValueYen)}(${latest.asOf}時点)`}
      >
        <path
          d={linePath(points.map((p) => p.savingsYen))}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <path
          d={linePath(points.map((p) => p.investmentValueYen))}
          fill="none"
          stroke="var(--income)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {points.map((p, i) => {
          const savingsPoint = toXY(i, p.savingsYen);
          const investmentPoint = toXY(i, p.investmentValueYen);
          return (
            <g key={p.asOf}>
              <circle cx={savingsPoint.x} cy={savingsPoint.y} r={4} fill="var(--accent)">
                <title>{`${p.asOf}: 貯金 ${formatYen(p.savingsYen)}`}</title>
              </circle>
              <circle cx={investmentPoint.x} cy={investmentPoint.y} r={4} fill="var(--income)">
                <title>{`${p.asOf}: 投資評価額 ${formatYen(p.investmentValueYen)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Legend color="var(--accent)" label={`貯金 ${formatYen(latest.savingsYen)}`} />
        <Legend
          color="var(--income)"
          label={`投資評価額 ${formatYen(latest.investmentValueYen)}`}
        />
      </div>

      <NetWorthTable points={points} />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
    </span>
  );
}

/** アクセシビリティ用の表(dataviz: table view は必ず用意する)。 */
function NetWorthTable({ points }: { points: readonly NetWorthPoint[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">月末時点の貯金・投資評価額の表</caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
            <th className="p-2 text-left font-medium" style={{ color: 'var(--ink-muted)' }}>
              月末
            </th>
            <th className="p-2 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
              貯金
            </th>
            <th className="p-2 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
              投資評価額
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.asOf} style={{ borderBottom: '1px solid var(--hairline)' }}>
              <td className="p-2" style={{ color: 'var(--ink)' }}>
                {p.asOf}
              </td>
              <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                {formatYen(p.savingsYen)}
              </td>
              <td className="tabular p-2 text-right" style={{ color: 'var(--ink-secondary)' }}>
                {formatYen(p.investmentValueYen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
