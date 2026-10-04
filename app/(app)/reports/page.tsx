import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { ForecastGraphic } from './forecast-graphic';
import { GoalChart } from './goal-chart';
import { goalLanding } from '@/domain/goal-range';
import { buildForecast } from '@/domain/forecast/engine';
import { addDays } from '@/lib/date';
import { FixedVariableCard } from './fixed-variable-card';
import { GenreDonutChart } from './genre-donut-chart';
import { IncomeExpenseChart } from './income-expense-chart';
import { MerchantRankingCard } from './merchant-ranking-card';
import { MonthSummaryRow } from './month-summary-row';
import { NetWorthChart } from './net-worth-chart';
import { PurposeBalanceCard } from './purpose-balance-card';
import { YearNetBarChart } from './year-net-bar-chart';
import { hasIncome } from '@/domain/summary-rules';
import { formatYen } from '@/domain/money';
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
  const engine = buildForecast({
    transactions: ledger.transactions.map((tx) => ({
      occurredOn: tx.occurredOn,
      genreId: tx.genreId,
      genreName: tx.genreName,
      amountYen: tx.amountYen,
      status: tx.status,
      kind: tx.kind,
      isTransfer: tx.isTransfer,
      reviewStatus: tx.reviewStatus,
      needsInput: tx.needsInput,
      merchantName: tx.label,
      description: tx.description,
    })),
    period: { from: ledger.period.from, to: ledger.period.to },
    today,
    trainingFrom: addDays(today, -90),
    recordStart: ledger.record.firstRecordedOn,
    confirmedFixedKeys: confirmedKeys,
    detectedSubscriptions: subscriptionCandidates,
    budgetYen:
      plan && plan.items.some((item) => item.targetYen > 0)
        ? plan.items.reduce((sum, item) => sum + item.targetYen, 0)
        : null,
    payday: null,
    dataVersion: `${ledger.transactions.length}:${ledger.transactions.at(-1)?.occurredOn ?? ''}`,
  });
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          レポート
        </h1>
        {engine ? (
          <>
            <p
              className="tabular mt-3 text-5xl font-semibold tracking-[-0.045em]"
              style={{ color: 'var(--ink)' }}
            >
              {formatYen(round100(engine.total.p50), { sign: 'never' })}
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              月末の着地は、10回中8回 {formatYen(round100(engine.total.p10), { sign: 'never' })}{' '}
              から {formatYen(round100(engine.total.p90), { sign: 'never' })}。
              {engine.probWithinBudget === null
                ? '目標の予算がないので、収まる確率は出していない。'
                : `予算内に収まる確率は ${Math.round(engine.probWithinBudget * 100)}%。${probabilityWord(engine.probWithinBudget)}。`}
              {engine.status === 'learning' ? ' 記録が増えるほど幅は狭くなる。' : ''}
              {engine.drivers[0]
                ? ` 超えるとしたら、原因の${Math.round(engine.drivers[0].shareOfRisk * 100)}%は${engine.drivers[0].categoryName}。`
                : ''}
              {engine.safeDailyAllowance !== null
                ? ` 8割の確率で予算内に収まる1日の額は ${formatYen(round100(engine.safeDailyAllowance), { sign: 'never' })}。`
                : ''}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            予測に足る記録がまだない。
          </p>
        )}
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

function round100(yen: number): number {
  return Math.round(yen / 100) * 100;
}
function probabilityWord(prob: number): string {
  if (prob >= 0.85) return 'ほぼ大丈夫';
  if (prob >= 0.6) return 'おそらく大丈夫';
  if (prob >= 0.4) return '五分五分';
  if (prob >= 0.15) return '厳しめ';
  return 'このままだと超えそう';
}
