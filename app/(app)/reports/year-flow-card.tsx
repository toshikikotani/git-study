import { formatYen } from '@/domain/money';
import { compareCurrentMonthToTrailingAverage } from '@/domain/spending';
import {
  loadCategorySpendingTrend,
  loadIncomeExpenseTrend,
  type IncomeExpenseTrend,
} from '@/features/reports/store';
import { CategoryTrendChart } from './category-trend-chart';

/** 「いつもの月」と比べるのに要る、記録のある月の数。 */
const MIN_MONTHS = 3;

const signed = (yen: number) =>
  `${yen >= 0 ? '+' : '−'}${formatYen(Math.abs(Math.round(yen)), { sign: 'never' })}`;

/**
 * 1年の流れ(デザイン仕様書の「分析」、ADR-090):直近12か月の収入(緑)と支出(橙)の棒、1年の収支と
 * 月平均(記録のある月だけで数える、ADR-127)、「いつもの月」との比較。「表で見る」で月ごとの表と
 * カテゴリの推移。明細を待たせないよう、後から出す。
 */
export async function YearFlowCard() {
  const [trend, categoryTrend] = await Promise.all([
    loadIncomeExpenseTrend().catch(() => null),
    loadCategorySpendingTrend().catch(() => null),
  ]);
  if (trend === null || trend.rows.length === 0) return null;
  const rows = trend.rows;
  const first = trend.monthKeys[0]!;
  const net = rows.reduce((sum, r) => sum + r.incomeYen - r.expenseYen, 0);
  const recorded = rows.filter((r) => r.incomeYen > 0 || r.expenseYen > 0);
  const current = trend.monthKeys[trend.monthKeys.length - 1]!;
  const pace =
    recorded.filter((r) => r.monthKey !== current).length >= MIN_MONTHS
      ? compareCurrentMonthToTrailingAverage(recorded, current)
      : null;

  const W = 326;
  const base = 108;
  const max = Math.max(1, ...rows.flatMap((r) => [r.incomeYen, r.expenseYen]));
  const slot = W / rows.length;
  const barW = Math.max(3, Math.min(10, slot * 0.32));
  const h = (yen: number) => (yen / max) * (base - 6);
  const label = (key: string) => `${Number(key.slice(5, 7))}月`;
  const ticks = [0, Math.floor(rows.length / 2), rows.length - 2, rows.length - 1].filter(
    (i, k, all) => i >= 0 && all.indexOf(i) === k,
  );
  const described = recorded
    .map(
      (r) =>
        `${label(r.monthKey)}は${r.incomeYen > 0 ? `収入${formatYen(r.incomeYen, { sign: 'never' })}・` : ''}支出${formatYen(r.expenseYen, { sign: 'never' })}`,
    )
    .join('、');

  return (
    <section
      aria-labelledby="year-flow"
      className="flex flex-col rounded-[22px] px-4 pt-5 pb-4"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="year-flow" className="text-[17px] font-semibold">
          1年の流れ
        </h2>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {first.slice(0, 4)}年{Number(first.slice(5, 7))}月〜
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} 132`}
        width="100%"
        role="img"
        aria-label={`月ごとの収入と支出。${described || '記録なし'}。`}
        className="mt-4"
      >
        <line x1="0" y1={base} x2={W} y2={base} stroke="var(--bar-quiet)" />
        {rows.map((r, i) => {
          const cx = slot * i + slot / 2;
          return (
            <g key={r.monthKey}>
              {r.incomeYen > 0 ? (
                <rect
                  x={cx - barW - 1}
                  y={base - h(r.incomeYen)}
                  width={barW}
                  height={h(r.incomeYen)}
                  rx="2"
                  fill="var(--income)"
                />
              ) : null}
              {r.expenseYen > 0 ? (
                <rect
                  x={cx + 1}
                  y={base - h(r.expenseYen)}
                  width={barW}
                  height={h(r.expenseYen)}
                  rx="2"
                  fill="var(--caution-mark)"
                  opacity="0.85"
                />
              ) : null}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text
            key={i}
            x={i === 0 ? 0 : i === rows.length - 1 ? W : slot * i + slot / 2}
            y="126"
            fontSize="11"
            fill="var(--ink-muted)"
            textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
          >
            {label(rows[i]!.monthKey)}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex gap-4 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm" style={{ background: 'var(--income)' }} />
          収入
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: 'var(--caution-mark)', opacity: 0.85 }}
          />
          支出
        </span>
      </div>
      <div className="tabular mt-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            1年の収支
          </span>
          <span
            className="text-[20px] font-bold"
            style={{ color: net >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
          >
            {signed(net)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            月平均
          </span>
          <span
            className="text-[20px] font-bold"
            style={{ color: net >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
          >
            {signed(net / Math.max(1, recorded.length))}
          </span>
        </div>
      </div>
      <p
        className="tabular mt-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed"
        style={{ background: 'var(--note)', color: 'var(--ink-secondary)' }}
      >
        {pace === null
          ? `記録が${MIN_MONTHS}か月たまると、「いつもの月」との比較を表示します。`
          : pace.differenceYen === 0
            ? `今月の支出は、いつもの月(平均 ${formatYen(pace.trailingAverageExpenseYen, { sign: 'never' })})と同じくらいです。`
            : `今月の支出は、いつもの月(平均 ${formatYen(pace.trailingAverageExpenseYen, { sign: 'never' })})より ${formatYen(Math.abs(pace.differenceYen), { sign: 'never' })} ${pace.differenceYen > 0 ? '多め' : '少なめ'}です。`}
      </p>
      {/* 月ごとの数字とカテゴリの推移は「表で見る」で開く(もとは「月ごとの表」の画面、ADR-127)。 */}
      <details className="mt-2">
        <summary
          className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          表で見る
        </summary>
        <MonthlyTable rows={rows} />
        {categoryTrend && categoryTrend.categories.length > 0 ? (
          <div className="mt-3">
            <CategoryTrendChart trend={categoryTrend} />
          </div>
        ) : null}
      </details>
    </section>
  );
}

/** 月ごとの収入・支出・収支(新しい月から)。 */
function MonthlyTable({ rows }: { rows: IncomeExpenseTrend['rows'] }) {
  const yen = (v: number) => formatYen(v, { sign: 'never' });
  return (
    <table className="tabular mt-1 w-full text-[14px]" style={{ color: 'var(--ink)' }}>
      <thead>
        <tr className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          <th scope="col" className="py-2 text-left font-normal">
            月
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            収入
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            支出
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            収支
          </th>
        </tr>
      </thead>
      <tbody>
        {[...rows].reverse().map((r) => {
          const diff = r.incomeYen - r.expenseYen;
          return (
            <tr key={r.monthKey} style={{ borderTop: '1px solid var(--hairline)' }}>
              <th scope="row" className="py-2 text-left font-normal">
                {r.monthKey.slice(0, 4)}年{Number(r.monthKey.slice(5, 7))}月
              </th>
              <td className="py-2 text-right">{yen(r.incomeYen)}</td>
              <td className="py-2 text-right">{yen(r.expenseYen)}</td>
              <td
                className="py-2 text-right font-semibold"
                style={{ color: diff >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
              >
                {signed(diff)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
