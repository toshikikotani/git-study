'use client';

import { useRef, useState } from 'react';

import { formatYen } from '@/domain/money';
import { formatDateJa, type DateOnly } from '@/lib/date';

/**
 * 完済シミュレーションの残高推移グラフ(FR-02)。
 *
 * これまで `ComparisonTable`(payoff-simulation.tsx)が総月数・総利息の
 * 「結果の数字」だけを比較していたのに対し、ここは「どう減っていくか」の
 * 過程そのものを見せる。`domain/payoff.ts` の `simulateTotalPayoff()` が
 * 既に月次の残高(`closingBalanceYen`)を計算済みなので、新しい計算ロジックは
 * 増やさず、その出力をそのまま線にするだけ。
 *
 * ── 色について ──────────────────────────────────────────────
 * 「この金額で返済」線は `var(--accent)`(globals.css が定める「返済・予算の
 * 残り(進捗)」の役割色)をそのまま使う。「最低返済のみ」線は役割を持たない
 * 比較対象なので `var(--ink-muted)` の破線にし、実線=本人が選んだ計画、
 * 破線=何もしなかった場合、という区別を色以外(線種)でも持たせる。
 */

export type PayoffCurvePoint = {
  monthIndex: number;
  dueOn: DateOnly;
  closingBalanceYen: number;
};

const WIDTH = 600;
const HEIGHT = 180;
const PADDING = 12;
/** チャートの見やすさのための上限(ほぼ発生しないが、極端に低い返済額での暴走を防ぐ)。 */
const MAX_CHART_MONTHS = 240;

type Point = { month: number; balanceYen: number };

export function PayoffCurveChart({
  baseline,
  proposed,
  startingBalanceYen,
}: {
  /** 最低返済のみのスケジュール(月次)。 */
  baseline: readonly PayoffCurvePoint[];
  /** 選択中のプランのスケジュール(月次)。 */
  proposed: readonly PayoffCurvePoint[];
  startingBalanceYen: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);

  if (baseline.length === 0 || proposed.length === 0) return null;

  const totalMonths = Math.min(baseline.length, MAX_CHART_MONTHS);
  const truncated = baseline.length > MAX_CHART_MONTHS;

  const baselineSeries: Point[] = [
    { month: 0, balanceYen: startingBalanceYen },
    ...baseline
      .slice(0, totalMonths)
      .map((r) => ({ month: r.monthIndex, balanceYen: r.closingBalanceYen })),
  ];
  const proposedSeries: Point[] = extendFlat(
    [
      { month: 0, balanceYen: startingBalanceYen },
      ...proposed.map((r) => ({ month: r.monthIndex, balanceYen: r.closingBalanceYen })),
    ],
    totalMonths,
  );

  const maxYen = Math.max(startingBalanceYen, 1);
  const stepX = WIDTH - PADDING * 2;

  function toXY(month: number, balanceYen: number): { x: number; y: number } {
    const x = PADDING + (month / totalMonths) * stepX;
    const y = HEIGHT - PADDING - (balanceYen / maxYen) * (HEIGHT - PADDING * 2);
    return { x, y };
  }

  function linePath(series: readonly Point[]): string {
    return series
      .map((p, i) => {
        const { x, y } = toXY(p.month, p.balanceYen);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  }

  const proposedPayoff = proposed[proposed.length - 1]!;
  const baselinePayoff = baseline[baseline.length - 1]!;

  function handleMove(event: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const month = Math.round(Math.min(Math.max(ratio, 0), 1) * totalMonths);
    setHoverMonth(month);
  }

  const hoverBaseline = hoverMonth === null ? null : balanceAtMonth(baselineSeries, hoverMonth);
  const hoverProposed = hoverMonth === null ? null : balanceAtMonth(proposedSeries, hoverMonth);

  return (
    <div className="mt-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full cursor-crosshair"
        role="img"
        aria-label={`最低返済のみでは${formatDateJa(baselinePayoff.dueOn)}に、選択中のプランでは${formatDateJa(proposedPayoff.dueOn)}に完済見込み`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverMonth(null)}
      >
        <path
          d={linePath(baselineSeries)}
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth={2}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
        <path
          d={linePath(proposedSeries)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* 完済到達点 */}
        <PayoffDot
          point={baselineSeries[baselineSeries.length - 1]!}
          toXY={toXY}
          color="var(--ink-muted)"
        />
        <PayoffDot
          point={proposedSeries[proposedSeries.length - 1]!}
          toXY={toXY}
          color="var(--accent)"
        />

        {hoverMonth !== null ? (
          <line
            x1={toXY(hoverMonth, 0).x}
            x2={toXY(hoverMonth, 0).x}
            y1={PADDING}
            y2={HEIGHT - PADDING}
            stroke="var(--hairline)"
            strokeWidth={1}
          />
        ) : null}
      </svg>

      {hoverMonth !== null && hoverBaseline !== null && hoverProposed !== null ? (
        <div
          className="mt-1 flex justify-between text-[11px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span>{hoverMonth}ヶ月後</span>
          <span className="tabular">
            最低返済 {formatYen(hoverBaseline, { sign: 'never' })} ・ この金額{' '}
            {formatYen(hoverProposed, { sign: 'never' })}
          </span>
        </div>
      ) : (
        <div
          className="mt-1 flex items-center gap-4 text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          <Legend color="var(--ink-muted)" dashed label="最低返済のみ" />
          <Legend color="var(--accent)" label="この金額で返済" />
        </div>
      )}

      {truncated ? (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
          最低返済のみの場合は{MAX_CHART_MONTHS}ヶ月以上かかるため、グラフは{MAX_CHART_MONTHS}
          ヶ月目までを表示しています
        </p>
      ) : null}

      <MilestoneTable baseline={baselineSeries} proposed={proposedSeries} />
    </div>
  );
}

/**
 * アクセシビリティ用の表(dataviz: table view は必ず用意する)。
 * 月次の全行(最大240行)を出すと逆に読みにくいため、1年ごとの節目だけに絞る。
 */
function MilestoneTable({
  baseline,
  proposed,
}: {
  baseline: readonly Point[];
  proposed: readonly Point[];
}) {
  const lastMonth = Math.max(
    baseline[baseline.length - 1]!.month,
    proposed[proposed.length - 1]!.month,
  );
  const months = [0];
  for (let m = 12; m < lastMonth; m += 12) months.push(m);
  months.push(lastMonth);

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[11px]">
        <caption className="sr-only">経過月ごとの残高(最低返済のみ・選択中のプラン)</caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
            <th className="p-1.5 text-left font-medium" style={{ color: 'var(--ink-muted)' }}>
              経過
            </th>
            <th className="p-1.5 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
              最低返済のみ
            </th>
            <th className="p-1.5 text-right font-medium" style={{ color: 'var(--ink-muted)' }}>
              この金額で返済
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month} style={{ borderBottom: '1px solid var(--hairline)' }}>
              <td className="p-1.5" style={{ color: 'var(--ink)' }}>
                {month === 0 ? '現在' : `${month}ヶ月後`}
              </td>
              <td className="tabular p-1.5 text-right" style={{ color: 'var(--ink-secondary)' }}>
                {formatYen(balanceAtMonth(baseline, month), { sign: 'never' })}
              </td>
              <td className="tabular p-1.5 text-right" style={{ color: 'var(--ink-secondary)' }}>
                {formatYen(balanceAtMonth(proposed, month), { sign: 'never' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayoffDot({
  point,
  toXY,
  color,
}: {
  point: Point;
  toXY: (month: number, balanceYen: number) => { x: number; y: number };
  color: string;
}) {
  const { x, y } = toXY(point.month, point.balanceYen);
  return <circle cx={x} cy={y} r={4} fill={color} />;
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-4"
        style={{
          background: dashed ? 'none' : color,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
        }}
        aria-hidden
      />
      {label}
    </span>
  );
}

/** 完済後は残高0円のまま、比較対象の終端(totalMonths)まで線を延ばす。 */
function extendFlat(series: readonly Point[], totalMonths: number): Point[] {
  const last = series[series.length - 1]!;
  if (last.month >= totalMonths) return [...series];
  return [...series, { month: totalMonths, balanceYen: last.balanceYen }];
}

/** 指定した月における残高を線形補間で求める(ホバー時の読み取り用)。 */
function balanceAtMonth(series: readonly Point[], month: number): number {
  if (month <= series[0]!.month) return series[0]!.balanceYen;
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]!;
    const curr = series[i]!;
    if (month <= curr.month) {
      if (curr.month === prev.month) return curr.balanceYen;
      const ratio = (month - prev.month) / (curr.month - prev.month);
      return Math.round(prev.balanceYen + (curr.balanceYen - prev.balanceYen) * ratio);
    }
  }
  return series[series.length - 1]!.balanceYen;
}
