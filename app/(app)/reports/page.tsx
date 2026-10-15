import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { InsightsList } from './insights-card';
import { AiInsightButton } from './ai-insight-button';
import { LandingRangesCard, type LandingRow } from './landing-ranges-card';
import { GenreWeekdayHeatmap, type GenreWeekdayCell } from './genre-weekday-heatmap';
import { VerificationCard } from './verification-card';
import { WhyCard } from './why-card';
import { SpeakButton } from '../_home/speak-button';
import { LandingHero, NextStepCard } from './landing-hero';
import { GoalChart } from './goal-chart';
import { periodDays } from '@/domain/period';
import { SpendingTrendChart } from './spending-trend-chart';
import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { listGenres } from '@/features/genre/store';
import { loadLatestRead } from '@/features/ai-report/forecast-read';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { reportInsights } from '@/domain/report-insights';
import { loadForecast } from '@/features/forecast/load';
import { addDays, addMonths } from '@/lib/date';
import { FixedVariableCard } from './fixed-variable-card';
import { GenreDonutChart } from './genre-donut-chart';
import { BubbleChart, type BubblePoint } from './bubble-chart';
import { IncomeExpenseChart } from './income-expense-chart';
import { MerchantRankingCard } from './merchant-ranking-card';
import { MonthSummaryRow } from './month-summary-row';
import { NetWorthChart } from './net-worth-chart';
import { PurposeBalanceCard } from './purpose-balance-card';
import { YearNetBarChart } from './year-net-bar-chart';
import { hasIncome } from '@/domain/summary-rules';
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
import { linesForGoal, withoutScheduled } from '@/features/category/pace';
import { formatDateJa, todayJst } from '@/lib/date';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { withMinDuration } from '@/lib/min-loading-duration';

export const dynamic = 'force-dynamic';
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
  const variableDaySpend: Record<string, number> = {};
  let fixedYenForTrend = 0;
  const [plan, genres] = await Promise.all([getCurrentPlan(today), listGenres().catch(() => [])]);
  const closedGenreIds = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  // 固定費ジャンルのID（forecastClosed またはプランの固定費項目）
  const fixedGenreIdSet = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  // ジャンル × 曜日の集計（分析用・固定費除く）
  const genreWeekdayMap = new Map<string, number>();
  for (const tx of ledger.transactions) {
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    const yen = -tx.amountYen;
    const isFixed = tx.mustPay || (tx.genreId !== null && fixedGenreIdSet.has(tx.genreId));
    if (isFixed) {
      fixedYenForTrend += yen;
    } else {
      variableDaySpend[tx.occurredOn] = (variableDaySpend[tx.occurredOn] ?? 0) + yen;
      // 曜日集計は固定費以外のみ
      if (tx.genreName) {
        const dow = new Date(tx.occurredOn + 'T00:00:00').getDay();
        const key = `${tx.genreName}|${dow}`;
        genreWeekdayMap.set(key, (genreWeekdayMap.get(key) ?? 0) + yen);
      }
    }
  }
  const genreWeekdayCells: GenreWeekdayCell[] = [...genreWeekdayMap.entries()].map(([key, yen]) => {
    const [genreName, dow] = key.split('|');
    return { genreName: genreName!, weekday: Number(dow), yen };
  });

  const genreBubbleMap = new Map<string, { name: string; count: number; total: number }>();
  for (const tx of ledger.transactions) {
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    const yen = -tx.amountYen;
    const name = tx.genreName ?? '未分類';
    const key = tx.genreId ?? name;
    const cur = genreBubbleMap.get(key) ?? { name, count: 0, total: 0 };
    cur.count += 1;
    cur.total += yen;
    genreBubbleMap.set(key, cur);
  }
  const bubblePoints: BubblePoint[] = [...genreBubbleMap.entries()]
    .map(([id, g]) => ({
      genreId: id,
      name: g.name,
      frequency: g.count,
      avgYen: g.count > 0 ? Math.round(g.total / g.count) : 0,
      totalYen: g.total,
    }))
    .filter((p) => p.frequency > 0);
  const budgetTotal = plan ? plan.items.reduce((sum, item) => sum + item.targetYen, 0) : 0;
  const hasGoal = plan !== null && budgetTotal > 0;
  const monthPeriod = {
    from: ledger.period.from,
    to: addDays(addMonths(ledger.period.from, 1), -1),
  };
  const period = plan ? { from: plan.periodStart, to: plan.periodEnd } : monthPeriod;
  const goalItems = plan ? plan.items.filter((item) => item.targetYen > 0) : [];
  const settle = <T,>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => {
        console.error('[reports] 着地の予測を読み込めませんでした', error);
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    );
  const [outcome] = await Promise.all([settle(loadForecast({ period }))]);
  const forecast = outcome.ok ? outcome.value.forecast : null;
  const monthForecast = forecast;
  const aiRead = await loadLatestRead(ledger.period.from).catch(() => null);
  const verification = outcome.ok ? outcome.value.verification : null;
  const forecastError = outcome.ok ? null : outcome.message;
  const budgetYen = hasGoal ? budgetTotal : null;
  const periodLabel = '今月';
  const endLabel = '月末';
  const previousMonthKey = trend.monthKeys.filter((key) => key < monthKey).at(-1);
  const previousByGenre =
    previousMonthKey !== undefined
      ? new Map(
          trend.rows
            .filter((row) => row.monthKey === previousMonthKey)
            .map((row) => [row.categoryId, row.spentYen] as const),
        )
      : undefined;
  const insights = forecast
    ? reportInsights({
        forecast,
        budgetYen,
        periodLabel,
        ...(previousByGenre ? { previousByGenre, previousLabel: '先月' } : {}),
      })
    : [];
  const landing = forecast?.total ?? null;
  const rangeRows: LandingRow[] = forecast
    ? landingRowsFrom({
        forecast,
        excludedByCategory: outcome.ok ? outcome.value.excludedByCategory : new Map(),
        closedGenreIds,
        cautionPrecision: outcome.ok ? outcome.value.cautionPrecision : null,
      })
    : [];
  const shown = new Set(rangeRows.map((row) => row.genreId));
  for (const tx of ledger.transactions) {
    if (tx.amountYen >= 0 || tx.genreId === null || shown.has(tx.genreId)) continue;
    const yen = rangeRows.find((row) => row.genreId === tx.genreId)?.baseYen ?? 0;
    if (yen > 0) continue;
    const spent = ledger.transactions
      .filter((item) => item.genreId === tx.genreId && item.amountYen < 0)
      .reduce((sum, item) => sum - item.amountYen, 0);
    if (spent <= 0) continue;
    shown.add(tx.genreId);
    rangeRows.push({
      genreId: tx.genreId,
      name: tx.genreName ?? '未分類',
      baseYen: spent,
      p10: spent,
      p50: spent,
      p90: spent,
      targetYen: null,
      exceedance: null,
      excludedYen: 0,
      status: 'settled',
      type: 'fixed',
      group: 'fixed',
      caution: null,
      cutPerWeekYen: null,
    });
  }
  const goalLines = (genreIds: readonly string[]) =>
    linesForGoal(
      genreIds.flatMap((genreId) =>
        buildCategoryLines(
          ledger.transactions.map((tx) => ({ ...tx, items: [] })),
          genreId,
          { from: ledger.period.from, to: period.to },
          today,
        ),
      ),
      period,
    );
  const fixedGenreIds = new Set(
    forecast
      ? landingRowsFrom({ forecast, closedGenreIds, limit: Number.MAX_SAFE_INTEGER })
          .filter((row) => row.group === 'fixed')
          .map((row) => row.genreId)
      : [],
  );
  const changeableItems = goalItems.filter((item) => !fixedGenreIds.has(item.genreId));
  const chart =
    hasGoal && budgetYen !== null && outcome.ok
      ? {
          lines: goalLines(goalItems.map((item) => item.genreId)),
          remaining: remainingOfTotal(outcome.value.forecast),
          changeable:
            fixedGenreIds.size > 0 && changeableItems.length > 0
              ? {
                  lines: goalLines(changeableItems.map((item) => item.genreId)),
                  budgetYen: changeableItems.reduce((sum, item) => sum + item.targetYen, 0),
                  remaining: withoutScheduled(
                    remainingOfTotal(outcome.value.forecast),
                    goalLines([...fixedGenreIds]),
                  ),
                }
              : null,
        }
      : null;
  const suggestion = forecast?.suggestion ?? null;
  return (
    <div className="rise space-y-4">
      <header className="space-y-3">
        <div className="px-1">
          <h1
            className="text-[34px] leading-none font-bold tracking-[-0.03em]"
            style={{ color: 'var(--ink)' }}
          >
            見通し
          </h1>
        </div>
      </header>
      {forecast && landing && forecast.total.p50 > 0 ? (
        <>
          <LandingHero
            endLabel={endLabel}
            landing={landing}
            budgetYen={budgetYen}
            probWithinBudget={forecast.probWithinBudget}
            provisional={forecast.provisional}
          />
          {hasGoal && budgetYen !== null && chart && plan ? (
            <GoalChart
              genreName="全体"
              lines={chart.lines}
              monthStart={ledger.period.from}
              monthEnd={period.to}
              today={today}
              budgetYen={budgetYen}
              goalFrom={plan.periodStart}
              goalTo={plan.periodEnd}
              remaining={chart.remaining}
              changeable={chart.changeable}
            />
          ) : null}
          <SpeakButton
            label="グラフを音で聞く"
            text={`${endLabel}の支出は${formatEstimate(landing.p50)}の見込み。80%の確率で${formatEstimateRange(landing.p10, landing.p90)}。${budgetYen !== null ? `予算は${formatEstimate(budgetYen, { approx: false })}。` : ''}`}
          />
          <SpendingTrendChart
            daySpend={variableDaySpend}
            fixedYen={fixedYenForTrend}
            from={plan?.periodStart}
            to={plan?.periodEnd}
            budgetPerDayYen={
              budgetYen != null && plan
                ? Math.round(
                    Math.max(0, budgetYen - fixedYenForTrend) /
                      Math.max(1, periodDays(plan.periodStart, plan.periodEnd)),
                  )
                : null
            }
            remainingPerDayYen={
              budgetYen != null && plan && outcome.ok
                ? Math.round(
                    Math.max(
                      0,
                      budgetYen -
                        fixedYenForTrend -
                        Math.max(0, outcome.value.forecast.actualYen - fixedYenForTrend),
                    ) / Math.max(1, outcome.value.forecast.remainingDays),
                  )
                : null
            }
          />
          <GenreWeekdayHeatmap cells={genreWeekdayCells} />
          <LandingRangesCard rows={rangeRows} periodLabel={periodLabel} />
          {budgetYen === null || forecast.drivers[0] ? (
            <p className="px-1 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {budgetYen === null ? '目標の予算がないので、収まるかどうかは出していない。' : ''}
              {forecast.drivers[0]
                ? `増えるとしたら、大きいのは${forecast.drivers[0].categoryName}。`
                : ''}
              {budgetYen !== null && forecast.expectedOvershoot > 0
                ? `超えるときは、平均で${formatEstimate(forecast.expectedOvershoot)}超える。`
                : ''}
            </p>
          ) : null}
          {suggestion ? <NextStepCard suggestion={suggestion} monthKey={monthKey} /> : null}
          {aiRead ? (
            <p className="px-1 text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              AIの読み({formatDateJa(aiRead.asOf)}時点):中央 {formatEstimate(aiRead.adjusted.p50)}。
              {aiRead.reason}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          {forecast === null
            ? `着地の予測を計算できませんでした。ほかの集計は下に出ています。${forecastError ? `(${forecastError})` : ''}`
            : '予測に足る記録がまだない。'}
        </p>
      )}
      <Link
        href="/reports/ai"
        className="flex min-h-11 items-center justify-center rounded-full px-4 text-[17px] font-semibold"
        style={{ background: 'var(--action)', color: 'var(--on-action)' }}
      >
        AIに見てもらう
      </Link>
      <InsightsList insights={insights} />
      <AiInsightButton />
      {forecast && forecast.total.p50 > 0 ? (
        <WhyCard forecast={forecast} endLabel={endLabel} closedGenreIds={closedGenreIds} />
      ) : null}
      {forecast ? (
        <VerificationCard verification={verification} monthStart={ledger.period.from} />
      ) : null}

      <MonthSummaryRow
        spentYen={ledger.totalSpentYen}
        incomeYen={ledger.totalIncomeYen}
        incomeRegistered={hasIncome(ledger.totalIncomeYen)}
        balance={monthForecast?.balance ?? null}
      />

      <GenreDonutChart
        rows={ledger.genreBreakdown.map((g) => ({
          genreId: g.genreId,
          name: g.genreName,
          spentYen: g.spentYen,
        }))}
        monthKey={monthKey}
      />
      <BubbleChart points={bubblePoints} />

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
