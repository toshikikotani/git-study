import Link from 'next/link';

import { SpeakButton } from '../_home/speak-button';
import { AiInsightButton } from '../reports/ai-insight-button';
import { GenreWeekdayHeatmap, type GenreWeekdayCell } from '../reports/genre-weekday-heatmap';
import { GoalChart } from '../reports/goal-chart';
import { InsightsList } from '../reports/insights-card';
import { LandingHero, NextStepCard } from '../reports/landing-hero';
import { SpendingTrendChart } from '../reports/spending-trend-chart';
import { WhyCard } from '../reports/why-card';
import { BudgetCategoryGroups } from './category-groups';
import { formatEstimate, formatEstimateRange } from '@/domain/forecast/format';
import { landingRowsFrom, type LandingRow } from '@/domain/forecast/landing-rows';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { formatYen } from '@/domain/money';
import { periodDays } from '@/domain/period';
import { reportInsights } from '@/domain/report-insights';
import { loadLatestRead } from '@/features/ai-report/forecast-read';
import { buildCategoryLines } from '@/features/category/model';
import { linesForGoal, withoutScheduled } from '@/features/category/pace';
import { loadForecast } from '@/features/forecast/load';
import { listGenres } from '@/features/genre/store';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import type { SpendingPlan } from '@/features/spending-plan/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { formatDateJa } from '@/lib/date';

/**
 * 予算の画面の本体(目標と見通しを1つに、ADR-088):着地の見込みとグラフ → 日ごとの支出 → 次の一手 →
 * カテゴリ(超えた・超えそう・予算内)→ なぜこの見込み? → 曜日とカテゴリ → AIの分析 → 固定費。
 * 数字はすべて目標の期間の1つの確率予測から出す(見出し・グラフ・カテゴリ・内訳で同じ数字)。
 */
export async function BudgetOverview({ plan, today }: { plan: SpendingPlan; today: string }) {
  const period = { from: plan.periodStart, to: plan.periodEnd };
  const [ledger, genres, trend] = await Promise.all([
    loadMonthlyLedger(),
    listGenres().catch(() => []),
    loadCategorySpendingTrend().catch(() => null),
  ]);
  const monthKey = ledger.period.from.slice(0, 7);
  const closedGenreIds = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));

  const outcome = await loadForecast({ period }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      console.error('[budget] 着地の予測を読み込めませんでした', error);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    },
  );
  const forecast = outcome.ok ? outcome.value.forecast : null;
  const aiRead = await loadLatestRead(ledger.period.from).catch(() => null);

  const goalItems = plan.items.filter((item) => item.targetYen > 0);
  const budgetYen = goalItems.reduce((sum, item) => sum + item.targetYen, 0) || null;
  const endLabel = `${Number(plan.periodEnd.slice(5, 7))}月${Number(plan.periodEnd.slice(8, 10))}日`;

  // 日ごとの支出(固定費をのぞく)と、カテゴリ × 曜日。
  const variableDaySpend: Record<string, number> = {};
  let fixedYen = 0;
  const weekday = new Map<string, number>();
  for (const tx of ledger.transactions) {
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    const yen = -tx.amountYen;
    if (tx.mustPay || (tx.genreId !== null && closedGenreIds.has(tx.genreId))) {
      fixedYen += yen;
      continue;
    }
    variableDaySpend[tx.occurredOn] = (variableDaySpend[tx.occurredOn] ?? 0) + yen;
    if (tx.genreName) {
      const key = `${tx.genreName}|${new Date(`${tx.occurredOn}T00:00:00`).getDay()}`;
      weekday.set(key, (weekday.get(key) ?? 0) + yen);
    }
  }
  const weekdayCells: GenreWeekdayCell[] = [...weekday.entries()].map(([key, yen]) => {
    const [genreName, dow] = key.split('|');
    return { genreName: genreName!, weekday: Number(dow), yen };
  });

  if (forecast === null || forecast.total.p50 <= 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {forecast === null
          ? `着地の見込みを計算できませんでした。${outcome.ok ? '' : `(${outcome.message})`}`
          : '見込みを出すには、まだ記録が足りません。'}
      </p>
    );
  }

  const rows: LandingRow[] = landingRowsFrom({
    forecast,
    excludedByCategory: outcome.ok ? outcome.value.excludedByCategory : new Map(),
    closedGenreIds,
    cautionPrecision: outcome.ok ? outcome.value.cautionPrecision : null,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const fixedRows = rows.filter((row) => row.group === 'fixed');
  const fixedIds = new Set(fixedRows.map((row) => row.genreId));

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
  const changeableItems = goalItems.filter((item) => !fixedIds.has(item.genreId));
  const remaining = remainingOfTotal(forecast);

  const previousMonthKey = trend?.monthKeys.filter((key) => key < monthKey).at(-1);
  const previousByGenre =
    trend && previousMonthKey !== undefined
      ? new Map(
          trend.rows
            .filter((row) => row.monthKey === previousMonthKey)
            .map((row) => [row.categoryId, row.spentYen] as const),
        )
      : undefined;
  const insights = reportInsights({
    forecast,
    budgetYen,
    periodLabel: '今期',
    ...(previousByGenre ? { previousByGenre, previousLabel: '先月' } : {}),
  });
  const days = Math.max(1, periodDays(plan.periodStart, plan.periodEnd));

  return (
    <>
      <LandingHero
        endLabel={endLabel}
        landing={forecast.total}
        budgetYen={budgetYen}
        probWithinBudget={forecast.probWithinBudget}
        provisional={forecast.provisional}
      />
      {budgetYen !== null ? (
        <GoalChart
          genreName="全体"
          lines={goalLines(goalItems.map((item) => item.genreId))}
          monthStart={ledger.period.from}
          monthEnd={period.to}
          today={today}
          budgetYen={budgetYen}
          goalFrom={plan.periodStart}
          goalTo={plan.periodEnd}
          remaining={remaining}
          changeable={
            fixedIds.size > 0 && changeableItems.length > 0
              ? {
                  lines: goalLines(changeableItems.map((item) => item.genreId)),
                  budgetYen: changeableItems.reduce((sum, item) => sum + item.targetYen, 0),
                  remaining: withoutScheduled(remaining, goalLines([...fixedIds])),
                }
              : null
          }
        />
      ) : null}
      <SpeakButton
        label="グラフを音で聞く"
        text={`${endLabel}の支出は${formatEstimate(forecast.total.p50)}の見込み。80%の確率で${formatEstimateRange(forecast.total.p10, forecast.total.p90)}。${budgetYen !== null ? `予算は${formatEstimate(budgetYen, { approx: false })}。` : ''}`}
      />

      <SpendingTrendChart
        daySpend={variableDaySpend}
        fixedYen={fixedYen}
        from={plan.periodStart}
        to={plan.periodEnd}
        budgetPerDayYen={
          budgetYen !== null ? Math.round(Math.max(0, budgetYen - fixedYen) / days) : null
        }
        remainingPerDayYen={
          budgetYen !== null
            ? Math.round(
                Math.max(0, budgetYen - fixedYen - Math.max(0, forecast.actualYen - fixedYen)) /
                  Math.max(1, forecast.remainingDays),
              )
            : null
        }
      />

      {forecast.suggestion ? (
        <NextStepCard suggestion={forecast.suggestion} monthKey={monthKey} />
      ) : null}

      <BudgetCategoryGroups
        rows={rows.filter((row) => row.group !== 'fixed')}
        monthKey={monthKey}
      />

      <WhyCard forecast={forecast} endLabel={endLabel} closedGenreIds={closedGenreIds} />

      <GenreWeekdayHeatmap cells={weekdayCells} />

      <section
        aria-labelledby="budget-ai"
        className="glass space-y-3 rounded-[28px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 id="budget-ai" className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
          AIの分析
        </h2>
        {aiRead ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {formatDateJa(aiRead.asOf)}時点の読み:中央 {formatEstimate(aiRead.adjusted.p50)}
            (記録からの見込みは {formatEstimate(forecast.total.p50)})。{aiRead.reason}
          </p>
        ) : null}
        <InsightsList insights={insights} />
        <AiInsightButton />
        <Link
          href="/reports/ai"
          className="flex min-h-11 items-center text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          日次・月次のAIレポートを見る
        </Link>
      </section>

      {fixedRows.length > 0 ? (
        <section
          aria-label="固定費"
          className="glass flex items-center justify-between gap-3 rounded-[22px] px-5 py-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold" style={{ color: 'var(--ink)' }}>
              固定費
            </span>
            <span className="block text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {fixedRows.map((row) => row.name).join('、')} · 見込みには含めて計算
            </span>
          </span>
          <span
            className="tabular shrink-0 text-base font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            {formatYen(
              fixedRows.reduce((sum, row) => sum + row.p50, 0),
              { sign: 'never' },
            )}
          </span>
        </section>
      ) : null}
    </>
  );
}
