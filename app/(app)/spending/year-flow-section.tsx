import { IncomeExpenseChart } from '../reports/income-expense-chart';
import { YearNetBarChart } from '../reports/year-net-bar-chart';
import { loadIncomeExpenseTrend } from '@/features/reports/store';

/** 1年の流れ(デザインの「家計簿」):月ごとの収入と支出、月ごとの収支。明細を待たせないよう後から出す。 */
export async function YearFlowSection() {
  const trend = await loadIncomeExpenseTrend().catch(() => null);
  if (trend === null) return null;
  return (
    <section aria-labelledby="year-flow" className="space-y-3">
      <h2 id="year-flow" className="px-1 pt-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
        1年の流れ
      </h2>
      <IncomeExpenseChart trend={trend} />
      <YearNetBarChart trend={trend} />
    </section>
  );
}
