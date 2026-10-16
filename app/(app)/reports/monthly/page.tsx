import { BackHeader } from '@/components/ui/back-header';
import { formatYen } from '@/domain/money';
import { loadCategorySpendingTrend, loadIncomeExpenseTrend } from '@/features/reports/store';
import { CategoryTrendChart } from '../category-trend-chart';
import { IncomeExpenseChart } from '../income-expense-chart';
import { YearNetBarChart } from '../year-net-bar-chart';

export const dynamic = 'force-dynamic';

const yen = (v: number) => formatYen(v, { sign: 'never' });

/**
 * 月ごとの表(分析から開く、ADR-090):直近12か月の収入・支出・差額の表と、収支のグラフ、
 * カテゴリごとの推移。
 */
export default async function MonthlyTablePage() {
  const [flow, trend] = await Promise.all([
    loadIncomeExpenseTrend().catch(() => null),
    loadCategorySpendingTrend().catch(() => null),
  ]);
  const rows = flow ? [...flow.rows].reverse() : [];
  return (
    <div className="rise flex flex-col gap-4">
      <BackHeader back={{ href: '/reports/month', label: '月のふりかえり' }} title="月ごとの表" />
      {rows.length > 0 ? (
        <section
          aria-label="月ごとの収入と支出"
          className="overflow-hidden rounded-2xl"
          style={{ background: 'var(--surface)' }}
        >
          <table className="tabular w-full text-[15px]" style={{ color: 'var(--ink)' }}>
            <thead>
              <tr className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                <th scope="col" className="px-4 py-3 text-left font-normal">
                  月
                </th>
                <th scope="col" className="px-2 py-3 text-right font-normal">
                  収入
                </th>
                <th scope="col" className="px-2 py-3 text-right font-normal">
                  支出
                </th>
                <th scope="col" className="px-4 py-3 text-right font-normal">
                  差額
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.incomeYen - r.expenseYen;
                return (
                  <tr key={r.monthKey} style={{ borderTop: '1px solid var(--hairline)' }}>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      {r.monthKey.slice(0, 4)}年{Number(r.monthKey.slice(5, 7))}月
                    </th>
                    <td className="px-2 py-3 text-right">{yen(r.incomeYen)}</td>
                    <td className="px-2 py-3 text-right">{yen(r.expenseYen)}</td>
                    <td
                      className="px-4 py-3 text-right font-semibold"
                      style={{ color: diff >= 0 ? 'var(--income)' : 'var(--state-caution)' }}
                    >
                      {diff >= 0 ? '+' : '−'}
                      {yen(Math.abs(diff))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="text-[15px]" style={{ color: 'var(--ink-muted)' }}>
          まだ記録がありません。
        </p>
      )}
      {flow ? (
        <>
          <IncomeExpenseChart trend={flow} />
          <YearNetBarChart trend={flow} />
        </>
      ) : null}
      {trend && trend.categories.length > 0 ? <CategoryTrendChart trend={trend} /> : null}
    </div>
  );
}
