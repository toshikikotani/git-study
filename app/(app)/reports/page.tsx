import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { InsightsList } from './insights-card';
import { LandingRangesCard, type LandingRow } from './landing-ranges-card';
import { VerificationCard } from './verification-card';
import { GoalChart } from './goal-chart';
import { reportInsights } from '@/domain/report-insights';
import { loadForecast } from '@/features/forecast/load';
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
import { formatDateJa, todayJst } from '@/lib/date';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { withMinDuration } from '@/lib/min-loading-duration';

// 直近6ヶ月の集計は都度 transactions から出す(スナップショットの保存機構が無い)。
// キャッシュに乗せると取り込み直後の反映が遅れる(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';
// 着地の予測は過去2年ぶんの学習と、過去の月での検証(初回だけ)を含むため、余裕を持たせる。
export const maxDuration = 60;

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

  const today = todayJst();
  const plan = await getCurrentPlan(today);
  // 目標があれば目標の期間・目標のジャンルで、なければ今月の全ジャンルで着地を出す。
  // 総予算は目標の期間の額なので、月の実績と混ぜない。
  const budgetTotal = plan ? plan.items.reduce((sum, item) => sum + item.targetYen, 0) : 0;
  const goalPlan = plan !== null && budgetTotal > 0 ? plan : null;
  const period = goalPlan
    ? { from: goalPlan.periodStart, to: goalPlan.periodEnd }
    : { from: ledger.period.from, to: addDays(addMonths(ledger.period.from, 1), -1) };
  const goalItems = goalPlan ? goalPlan.items.filter((item) => item.targetYen > 0) : [];
  const { forecast, verification } = await loadForecast({
    period,
    budgetYen: goalPlan ? budgetTotal : null,
    ...(goalPlan
      ? {
          scope: { genreIds: new Set(goalItems.map((item) => item.genreId)), excludeSpecial: true },
          categoryTargets: goalItems.map((item) => ({
            categoryId: item.genreId,
            categoryName: item.genreName,
            targetYen: item.targetYen,
          })),
        }
      : {}),
  });
  const budgetYen = goalPlan ? budgetTotal : null;
  const periodLabel = goalPlan ? 'この目標の期間' : '今月';
  const endLabel = goalPlan ? `${formatDateJa(period.to)}` : '月末';

  const previousMonthKey = trend.monthKeys.filter((key) => key < monthKey).at(-1);
  const previousByGenre =
    !goalPlan && previousMonthKey !== undefined
      ? new Map(
          trend.rows
            .filter((row) => row.monthKey === previousMonthKey)
            .map((row) => [row.categoryId, row.spentYen] as const),
        )
      : undefined;
  const insights = reportInsights({
    forecast,
    budgetYen,
    periodLabel,
    ...(previousByGenre ? { previousByGenre, previousLabel: '先月' } : {}),
  });
  const landing = forecast.total;
  const rangeRows: LandingRow[] = forecast.byCategory
    .filter((c) => c.landing.p90 > 0)
    .sort((a, b) => b.landing.p50 - a.landing.p50)
    .slice(0, 8)
    .map((c) => ({
      genreId: c.categoryId,
      name: c.categoryName,
      baseYen: c.baseYen,
      p10: c.landing.p10,
      p50: c.landing.p50,
      p90: c.landing.p90,
      targetYen: c.targetYen,
      exceedance: c.exceedance,
    }));
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          レポート
        </h1>
        {forecast.total.p50 > 0 ? (
          <>
            <p
              className="tabular mt-3 text-4xl font-semibold tracking-[-0.045em]"
              style={{ color: 'var(--ink)' }}
            >
              {formatYen(round100(landing.p50), { sign: 'never' })}
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
              {endLabel}の着地は、10回中8回 {formatYen(round100(landing.p10), { sign: 'never' })}{' '}
              から {formatYen(round100(landing.p90), { sign: 'never' })}。
              {budgetYen !== null
                ? forecast.probWithinBudget !== null
                  ? `予算 ${formatYen(budgetYen, { sign: 'never' })} に収まる確率は${Math.round(forecast.probWithinBudget * 100)}%。`
                  : ''
                : '目標の予算がないので、収まるかどうかは出していない。'}
              {forecast.drivers[0]
                ? ` 増えるとしたら、大きいのは${forecast.drivers[0].categoryName}。`
                : ''}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            予測に足る記録がまだない。
          </p>
        )}
      </header>
      {goalPlan && budgetYen !== null ? (
        <GoalChart
          genreName="全体"
          lines={linesForGoal(
            goalItems.flatMap((item) =>
              buildCategoryLines(
                ledger.transactions.map((tx) => ({ ...tx, items: [] })),
                item.genreId,
                { from: ledger.period.from, to: period.to },
                today,
              ),
            ),
            { from: goalPlan.periodStart, to: goalPlan.periodEnd },
          )}
          monthStart={ledger.period.from}
          monthEnd={period.to}
          today={today}
          budgetYen={budgetYen}
          goalFrom={goalPlan.periodStart}
          goalTo={goalPlan.periodEnd}
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
      <InsightsList insights={insights} />
      <LandingRangesCard rows={rangeRows} periodLabel={periodLabel} />
      <VerificationCard verification={verification} />

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
