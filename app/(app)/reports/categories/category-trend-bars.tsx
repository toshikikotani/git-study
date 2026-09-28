import { formatYen } from '@/domain/money';
import { formatMonthJa } from '@/lib/date';
import type { PeriodSpend } from '@/domain/spending';

/**
 * カテゴリ別ページの上段:直近12ヶ月の月次推移(本人発案)。
 *
 * 見た目は ../category-trend-chart.tsx(/reports の全カテゴリ横並び、6ヶ月)
 * と同じ棒グラフだが、こちらは1カテゴリだけを深掘りするため12ヶ月に伸ばした
 * ——本人の依頼「月次推移(直近6〜12ヶ月)」の長い方を採用(短い6ヶ月は
 * /reports の一覧グラフで既に見られる)。
 */
export function CategoryTrendBars({
  monthKeys,
  monthly,
}: {
  monthKeys: readonly string[];
  monthly: readonly PeriodSpend[];
}) {
  const spentByMonth = new Map(monthly.map((row) => [row.period, row.spentYen]));
  const values = monthKeys.map((monthKey) => spentByMonth.get(monthKey) ?? 0);
  const totalYen = values.reduce((sum, v) => sum + v, 0);
  const maxYen = Math.max(...values, 1);
  const peakIndex = values.lastIndexOf(Math.max(...values));

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          月次推移
        </h2>
        <span className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
          12ヶ月合計 {formatYen(totalYen)}
        </span>
      </div>

      <div className="mt-4 flex h-24 items-end gap-[2px]">
        {values.map((spentYen, index) => {
          const percent = Math.round((spentYen / maxYen) * 100);
          return (
            <div
              key={monthKeys[index]}
              className="relative h-full flex-1 overflow-hidden rounded-t-[4px]"
              style={{ background: 'var(--over-track)' }}
              title={`${formatMonthJa(monthKeys[index]!)}: ${formatYen(spentYen)}`}
            >
              {index === peakIndex && spentYen > 0 ? (
                <span
                  className="tabular absolute inset-x-0 -top-4 text-center text-[9px]"
                  style={{ color: 'var(--ink-muted)' }}
                  aria-hidden
                >
                  {formatYen(spentYen)}
                </span>
              ) : null}
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[4px]"
                style={{ height: `${percent}%`, background: 'var(--over)' }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-[2px]">
        {monthKeys.map((monthKey) => (
          <span
            key={monthKey}
            className="tabular flex-1 text-center text-[10px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatMonthJa(monthKey)}
          </span>
        ))}
      </div>
    </div>
  );
}
