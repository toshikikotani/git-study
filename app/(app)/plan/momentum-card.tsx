import { formatYen } from '@/domain/money';
import {
  LONG_WINDOW,
  SHORT_WINDOW,
  buildDailySeries,
  computeTrend,
  directionLabel,
} from '@/domain/trend';
import { addDays } from '@/lib/date';

/** 2026-10-01 → 10/1 */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

const yen = (v: number) => formatYen(Math.round(v), { sign: 'never' });

/**
 * 最近の勢い(デザイン仕様書の「見通し」、ADR-090):期間のはじめから今日までの1日ごとの支出(固定費を
 * のぞく)。予算ペースを超えた日は濃く、点線が予算ペース。下に直近7日・21日の平均、予算ペース、残りの目安。
 */
export function MomentumCard({
  daySpend,
  fixedYen,
  from,
  today,
  budgetPerDayYen,
  remainingPerDayYen,
}: {
  /** 日ごとの使った額(正の数・固定費をのぞく)。期間のはじめより前の21日も含める。 */
  daySpend: Readonly<Record<string, number>>;
  fixedYen: number;
  from: string;
  today: string;
  budgetPerDayYen: number | null;
  remainingPerDayYen: number | null;
}) {
  const shown = buildDailySeries(daySpend, from, today);
  if (shown.length === 0) return null;
  const trend = computeTrend(buildDailySeries(daySpend, addDays(from, -(LONG_WINDOW - 1)), today));
  const pace = budgetPerDayYen ?? 0;
  const W = 326;
  const H = 76;
  const base = 62;
  const max = Math.max(pace, ...shown.map((d) => d.spentYen), 1) * 1.1;
  const slot = W / shown.length;
  const barW = Math.max(2, Math.min(14, slot * 0.66));
  const y = (v: number) => base - (v / max) * (base - 4);
  const overDays = shown.filter((d) => pace > 0 && d.spentYen > pace).length;
  const increasing = trend.direction === 'increasing';

  return (
    <section
      aria-labelledby="momentum"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="momentum" className="text-[17px] font-semibold">
          最近の勢い
        </h2>
        <span
          className="rounded-full px-3 py-1 text-[13px] font-semibold"
          style={
            increasing
              ? { background: 'var(--state-caution-track)', color: 'var(--state-caution)' }
              : { background: 'var(--income-track)', color: 'var(--income)' }
          }
        >
          {directionLabel(trend.direction)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${md(from)}から${md(today)}までの1日ごとの支出。${pace > 0 ? `予算ペース${yen(pace)}を超えた日が${overDays}日。` : ''}`}
        className="mt-3"
      >
        <line x1="0" y1={base} x2={W} y2={base} stroke="var(--bar-quiet)" />
        {shown.map((d, i) =>
          d.spentYen <= 0 ? null : (
            <rect
              key={d.date}
              x={slot * i + (slot - barW) / 2}
              y={y(d.spentYen)}
              width={barW}
              height={base - y(d.spentYen)}
              rx={Math.min(3, barW / 2)}
              fill={pace > 0 && d.spentYen > pace ? 'var(--accent)' : 'var(--bar-quiet)'}
            />
          ),
        )}
        {pace > 0 ? (
          <line
            x1="0"
            y1={y(pace)}
            x2={W}
            y2={y(pace)}
            stroke="var(--caution-mark)"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
        ) : null}
        <text x="0" y="74" fontSize="10" fill="var(--ink-muted)">
          {md(from)}
        </text>
        <text x={W - 6} y="74" fontSize="10" fill="var(--ink-muted)" textAnchor="end">
          {md(today)}
        </text>
      </svg>
      <div className="tabular mt-4 grid grid-cols-2 gap-3">
        <Stat label={`直近${SHORT_WINDOW}日の平均`} value={trend.latestShortMa} big />
        <Stat label="予算ペース" value={budgetPerDayYen} big caution />
        <Stat label={`直近${LONG_WINDOW}日の平均`} value={trend.latestLongMa} />
        <Stat label="残りの目安" value={remainingPerDayYen} />
      </div>
      <p className="mt-3 text-[12px] leading-normal" style={{ color: 'var(--ink-muted)' }}>
        {fixedYen > 0 ? `固定費（${yen(fixedYen)}）はこのグラフに含めていません。` : ''}
        点線は予算ペースです。
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  big = false,
  caution = false,
}: {
  label: string;
  value: number | null;
  big?: boolean;
  caution?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </span>
      <span
        className={big ? 'text-[20px] font-bold' : 'text-[17px] font-semibold'}
        style={{ color: caution ? 'var(--state-caution)' : 'var(--ink)' }}
      >
        {value === null ? '—' : yen(value)}
      </span>
    </div>
  );
}
