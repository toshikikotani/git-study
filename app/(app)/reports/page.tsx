import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { ForecastGraphic } from './forecast-graphic';
import { GoalChart } from './goal-chart';
import { buildForecast } from '@/domain/forecast/engine';
import { forecastPlan } from '@/domain/plan-forecast';
import { loadForecastRows } from '@/features/spending-plan/forecast-rows';
import { addDays, addMonths } from '@/lib/date';
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
import { linesForGoal } from '@/features/category/pace';
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
  // 総予算は目標の期間の額。月の実績・日数と組み合わせて着地を出さない(期間は月と一致しない)。
  const budgetYen = plan ? plan.items.reduce((sum, item) => sum + item.targetYen, 0) : null;
  const monthEnd = plan?.periodEnd ?? addDays(addMonths(ledger.period.from, 1), -1);
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
    period: { from: ledger.period.from, to: monthEnd },
    today,
    trainingFrom: addDays(today, -90),
    recordStart: ledger.record.firstRecordedOn,
    confirmedFixedKeys: confirmedKeys,
    detectedSubscriptions: subscriptionCandidates,
    budgetYen: budgetYen !== null && budgetYen > 0 ? budgetYen : null,
    payday: null,
    dataVersion: `${ledger.transactions.length}:${ledger.transactions.at(-1)?.occurredOn ?? ''}`,
  });

  const planLanding = plan
    ? await (async () => {
        const { remainingDays, rows } = await loadForecastRows({
          start: plan.periodStart,
          end: plan.periodEnd,
          items: plan.items,
          today,
        });
        return forecastPlan({
          remainingDays,
          seed: `${plan.periodStart}:${plan.periodEnd}:${today}`,
          genres: rows.map((row) => row.input),
        });
      })()
    : null;
  const landing = {
    p10:
      planLanding?.genres.reduce((sum, genre) => sum + (genre.lowYen ?? 0), 0) || engine.total.p10,
    p50: planLanding?.totalMedianYen ?? engine.total.p50,
    p90:
      planLanding?.genres.reduce((sum, genre) => sum + (genre.highYen ?? 0), 0) || engine.total.p90,
  };
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          レポート
        </h1>
        {engine ? (
          <>
            <p
              className="tabular mt-3 text-4xl font-semibold tracking-[-0.045em]"
              style={{ color: 'var(--ink)' }}
            >
              {formatYen(round100(landing.p50), { sign: 'never' })}
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              月末の着地は、10回中8回 {formatYen(round100(landing.p10), { sign: 'never' })} から{' '}
              {formatYen(round100(landing.p90), { sign: 'never' })}。
              {budgetYen !== null && budgetYen > 0
                ? landing.p50 > budgetYen
                  ? `予算 ${formatYen(budgetYen, { sign: 'never' })} を ${formatYen(round100(landing.p50 - budgetYen), { sign: 'never' })} 超えそう。`
                  : `予算 ${formatYen(budgetYen, { sign: 'never' })} には収まりそう。`
                : '目標の予算がないので、収まるかどうかは出していない。'}
              {engine.drivers[0]
                ? ` 増えるとしたら、大きいのは${engine.drivers[0].categoryName}。`
                : ''}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            予測に足る記録がまだない。
          </p>
        )}
      </header>
      {plan && budgetYen !== null && budgetYen > 0 ? (
        <GoalChart
          genreName="全体"
          lines={linesForGoal(
            plan.items
              .filter((item) => item.targetYen > 0)
              .flatMap((item) =>
                buildCategoryLines(
                  ledger.transactions.map((tx) => ({ ...tx, items: [] })),
                  item.genreId,
                  { from: ledger.period.from, to: monthEnd },
                  today,
                ),
              ),
            { from: plan.periodStart, to: plan.periodEnd },
          )}
          monthStart={ledger.period.from}
          monthEnd={monthEnd}
          today={today}
          budgetYen={budgetYen}
          goalFrom={plan.periodStart}
          goalTo={plan.periodEnd}
          landing={landing}
        />
      ) : null}
      <Link
        href="/reports/ai"
        className="flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        AIに見てもらう
      </Link>
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
