import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { InsightsList } from './insights-card';
import { LandingRangesCard, type LandingRow } from './landing-ranges-card';
import { VerificationCard } from './verification-card';
import { WhyCard } from './why-card';
import { SpeakButton } from '../_home/speak-button';
import { LandingHero, NextStepCard } from './landing-hero';
import { GoalChart } from './goal-chart';
import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { listGenres } from '@/features/genre/store';
import { loadLatestRead } from '@/features/ai-report/forecast-read';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { reportInsights } from '@/domain/report-insights';
import { goalForecastArgs } from '@/features/forecast/goal';
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

// 直近6ヶ月の集計は都度 transactions から出す(スナップショットの保存機構が無い)。
// キャッシュに乗せると取り込み直後の反映が遅れる(ADR-001と同じ考え方)。
export const dynamic = 'force-dynamic';
// 着地の予測は過去2年ぶんの学習と、過去の月での検証(初回だけ)を含むため、余裕を持たせる。
export const maxDuration = 60;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scope: scopeParam } = await searchParams;
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
  const [plan, genres] = await Promise.all([getCurrentPlan(today), listGenres().catch(() => [])]);
  const closedGenreIds = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));
  // 目標があれば、既定は目標の期間・すべての支出。「全部」に切り替えると、
  // 今月のすべての支出で出す。どちらの範囲かは、画面の上に名前で出す(設計書 v3 2.2 の2)。
  const budgetTotal = plan ? plan.items.reduce((sum, item) => sum + item.targetYen, 0) : 0;
  const hasGoal = plan !== null && budgetTotal > 0;
  const goalPlan = hasGoal && scopeParam !== 'all' ? plan : null;
  const monthPeriod = {
    from: ledger.period.from,
    to: addDays(addMonths(ledger.period.from, 1), -1),
  };
  const period = goalPlan ? { from: goalPlan.periodStart, to: goalPlan.periodEnd } : monthPeriod;
  const goalItems = goalPlan ? goalPlan.items.filter((item) => item.targetYen > 0) : [];
  const goalArgs = goalForecastArgs(goalPlan);
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
  // 予測が失敗しても、ほかの集計(下のカード)は見られるようにする。月末の収支は、目標の範囲では
  // なく今月の全部で出す(収入は1か月分なので)。目標の範囲のときは、全部の予測も並べて読む。
  const [outcome, monthOutcome] = await Promise.all([
    settle(loadForecast(goalArgs ?? { period })),
    goalPlan ? settle(loadForecast({ period: monthPeriod })) : Promise.resolve(null),
  ]);
  const forecast = outcome.ok ? outcome.value.forecast : null;
  const monthForecast = goalPlan
    ? monthOutcome?.ok
      ? monthOutcome.value.forecast
      : null
    : forecast;
  // AIの読み(AIレポートで作ったもの)。今月の全体の見込みのときだけ並べる(目標の範囲とは違うため)。
  const aiRead = goalPlan ? null : await loadLatestRead(ledger.period.from).catch(() => null);
  const verification = outcome.ok ? outcome.value.verification : null;
  const forecastError = outcome.ok ? null : outcome.message;
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
      type: 'committed',
      group: 'fixed',
      caution: null,
      cutPerWeekYen: null,
    });
  }
  // グラフ(設計書 v3 3.4)。目標のジャンルの行と、「変えられる支出だけ」の行・予算・予測。
  const goalLines = (genreIds: readonly string[]) =>
    linesForGoal(
      genreIds.flatMap((genreId) =>
        buildCategoryLines(
          // 目標の範囲はすべての支出。
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
    goalPlan && budgetYen !== null && outcome.ok
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
        {hasGoal ? <ScopeSwitch current={goalPlan ? 'goal' : 'all'} /> : null}
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
          {goalPlan && budgetYen !== null && chart ? (
            <GoalChart
              genreName="全体"
              lines={chart.lines}
              monthStart={ledger.period.from}
              monthEnd={period.to}
              today={today}
              budgetYen={budgetYen}
              goalFrom={goalPlan.periodStart}
              goalTo={goalPlan.periodEnd}
              remaining={chart.remaining}
              changeable={chart.changeable}
            />
          ) : null}
          <SpeakButton
            label="グラフを音で聞く"
            text={`${endLabel}の支出は${formatEstimate(landing.p50)}の見込み。80%の確率で${formatEstimateRange(landing.p10, landing.p90)}。${budgetYen !== null ? `予算は${formatEstimate(budgetYen, { approx: false })}。` : ''}`}
          />
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
      {forecast && forecast.total.p50 > 0 ? (
        <WhyCard forecast={forecast} endLabel={endLabel} />
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

/** 「目標のジャンル」と「ぜんぶ」の切り替え(デザインの区切りボタン。目標があるときだけ)。 */
function ScopeSwitch({ current }: { current: 'goal' | 'all' }) {
  const item = (key: 'goal' | 'all', label: string) => (
    <Link
      href={key === 'all' ? { pathname: '/reports', query: { scope: 'all' } } : '/reports'}
      aria-current={current === key ? 'page' : undefined}
      className="glass flex min-h-9 flex-1 items-center justify-center rounded-[10px] px-3 text-sm"
      style={{
        background: current === key ? 'var(--surface)' : 'transparent',
        boxShadow: current === key ? 'var(--card-shadow)' : undefined,
        color: current === key ? 'var(--ink)' : 'var(--ink-secondary)',
        fontWeight: current === key ? 600 : 500,
      }}
    >
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="表示する範囲"
      className="flex gap-1 rounded-xl p-1"
      style={{ background: 'var(--surface-fill)' }}
    >
      {item('goal', '目標のジャンル')}
      {item('all', 'ぜんぶ')}
    </nav>
  );
}
