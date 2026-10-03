import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { ForecastGraphic } from './forecast-graphic';
import { GoalChart } from './goal-chart';
import { goalLanding } from '@/domain/goal-range';
import { FixedVariableCard } from './fixed-variable-card';
import { GenreDonutChart } from './genre-donut-chart';
import { IncomeExpenseChart } from './income-expense-chart';
import { MerchantRankingCard } from './merchant-ranking-card';
import { MonthSummaryRow } from './month-summary-row';
import { NetWorthChart } from './net-worth-chart';
import { PurposeBalanceCard } from './purpose-balance-card';
import { YearNetBarChart } from './year-net-bar-chart';
import { hasIncome } from '@/domain/summary-rules';
import { forecastReport } from '@/domain/report-forecast';
import {
  loadAccountBalanceByPurpose,
  loadCategorySpendingTrend,
  loadIncomeExpenseTrend,
  loadMerchantSpendingRanking,
} from '@/features/reports/store';
import { loadNetWorthTrend } from '@/features/net-worth/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { buildCategoryLines } from '@/features/category/model';
import { todayJst } from '@/lib/date';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { withMinDuration } from '@/lib/min-loading-duration';

// 直近6ヶ月の集計は都度 transactions から出す(スナップショットの保存機構が無い)。
// キャッシュに乗せると取り込み直後の反映が遅れる(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const [
    trend,
    netWorthPoints,
    incomeExpenseTrend,
    merchantRanking,
    purposeBalances,
    ledger,
    fixedVariable,
    subscriptionCandidates,
    confirmedKeys,
  ] = await withMinDuration(
    Promise.all([
      loadCategorySpendingTrend(),
      // net_worth_snapshots は本番マイグレーション未適用の間、テーブル自体が
      // 無く失敗する(TASKS.md のブロック事項参照)。本人にとっては「記録が
      // まだ無い」のと同じなので、レポート画面全体を落とさず空状態にする。
      loadNetWorthTrend().catch(() => []),
      loadIncomeExpenseTrend(),
      loadMerchantSpendingRanking(),
      loadAccountBalanceByPurpose(),
      loadMonthlyLedger(),
      loadFixedVariableSplit(),
      loadDetectedSubscriptions(),
      listConfirmedFixedCostKeys(),
    ]),
  );
  const monthKey = ledger.period.from.slice(0, 7);

  const scheduledByGenre: Record<string, number> = {};
  for (const tx of ledger.transactions) {
    if (tx.status !== 'scheduled' || tx.isTransfer || tx.needsInput || !tx.genreId) continue;
    scheduledByGenre[tx.genreId] = (scheduledByGenre[tx.genreId] ?? 0) + Math.abs(tx.amountYen);
  }
  const forecast = forecastReport({ ...trend, currentMonthKey: monthKey, scheduledByGenre });
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  const history = trend.monthKeys
    .filter((key) => key < monthKey)
    .map((key) =>
      trend.rows.filter((row) => row.monthKey === key).reduce((sum, row) => sum + row.spentYen, 0),
    );
  const goal = plan
    ? goalLanding({
        targetYen: plan.items.reduce((sum, item) => sum + item.targetYen, 0),
        spentYen: ledger.totalSpentYen,
        scheduledYen: ledger.totals.scheduledYen,
        elapsedDays: ledger.forecast.elapsedDays,
        totalDays: ledger.forecast.totalDaysInMonth,
        history,
      })
    : null;
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          レポート
        </h1>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {goal ? '目標の予算と、着地の範囲。' : '進行中の目標がない。'}
        </p>
      </header>
      {goal && plan ? (
        <GoalChart
          genreName="目標"
          lines={plan.items.flatMap((item) =>
            buildCategoryLines(
              ledger.transactions.map((tx) => ({ ...tx, items: [] })),
              item.genreId,
              { from: ledger.period.from, to: ledger.period.to },
              today,
            ),
          )}
          monthStart={ledger.period.from}
          monthEnd={ledger.period.to}
          today={today}
          budgetYen={goal.targetYen}
          goalFrom={plan.periodStart}
          goalTo={plan.periodEnd}
          range={goal}
        />
      ) : null}
      <ForecastGraphic {...forecast} />

      <MonthSummaryRow
        spentYen={ledger.totalSpentYen}
        incomeYen={ledger.totalIncomeYen}
        incomeRegistered={hasIncome(ledger.totalIncomeYen)}
      />

      <GenreDonutChart
        rows={ledger.genreBreakdown.map((g) => ({
          genreId: g.genreId,
          name: g.genreName,
          spentYen: g.spentYen,
        }))}
        monthKey={monthKey}
      />

      <FixedVariableCard
        fixedYen={fixedVariable.fixedYen}
        variableYen={fixedVariable.variableYen}
        candidates={subscriptionCandidates}
        confirmedKeys={[...confirmedKeys]}
      />

      <IncomeExpenseChart trend={incomeExpenseTrend} />

      <YearNetBarChart trend={incomeExpenseTrend} />

      {trend.categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          直近6ヶ月に支出の記録がありません。
        </p>
      ) : (
        <CategoryTrendChart trend={trend} />
      )}

      <Link
        href="/reports/genres"
        className="block text-xs font-medium"
        style={{ color: 'var(--accent)' }}
      >
        AIによる客観的なジャンルで見る →
      </Link>

      <MerchantRankingCard ranking={merchantRanking} />

      <NetWorthChart points={netWorthPoints} />

      <PurposeBalanceCard balances={purposeBalances} />
    </div>
  );
}
