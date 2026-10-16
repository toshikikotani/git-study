import type { Route } from 'next';
import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { formatYen } from '@/domain/money';
import { periodDays } from '@/domain/period';
import { reportInsights } from '@/domain/report-insights';
import { LONG_WINDOW } from '@/domain/trend';
import { loadMonthlyReport } from '@/features/ai-report/store';
import { buildCategoryLines, UNCATEGORIZED_KEY } from '@/features/category/model';
import { buildCumulative, linesForGoal, withoutScheduled } from '@/features/category/pace';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { listGenres } from '@/features/genre/store';
import { loadCategorySpendingTrend } from '@/features/reports/store';
import type { SpendingPlan } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import { addDays, daysBetween } from '@/lib/date';
import { WhyCard } from '../reports/why-card';
import { AiCard } from './ai-card';
import { ForecastHero, type ScopeData } from './forecast-hero';
import { MomentumCard } from './momentum-card';
import { ProbabilityCard } from './probability-card';

/** 2026-10-14T… → 10月14日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/**
 * 見通しの本体(デザイン仕様書の「見通し」、ADR-090):見込み(対象の切り替え・グラフ)→ 予算内に
 * 収まる確率 → なぜ約X円？ → 最近の勢い → AIの気づき → 固定費・カテゴリごとの予算。
 * 数字はすべて目標の期間の1つの確率予測から出す(ホームの「今期の見通し」と同じ数字)。
 */
export async function BudgetOverview({ plan, today }: { plan: SpendingPlan; today: string }) {
  const period = { from: plan.periodStart, to: plan.periodEnd };
  const goal = goalForecastArgs(plan);
  const monthKey = today.slice(0, 7);
  const [loaded, genres, trend, report] = await Promise.all([
    loadLedgerTransactions(
      { from: addDays(period.from, -(LONG_WINDOW - 1)), to: period.to },
      today,
    ),
    listGenres().catch(() => []),
    loadCategorySpendingTrend().catch(() => null),
    loadMonthlyReport(monthKey).catch(() => null),
  ]);
  const closedGenreIds = new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id));

  const outcome = await loadForecast(goal ?? { period }).then(
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
  if (forecast === null || forecast.total.p50 <= 0) {
    return (
      <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
        {forecast === null
          ? `着地の見込みを計算できませんでした。${outcome.ok ? '' : `(${outcome.message})`}`
          : '見込みを出すには、まだ記録が足りません。'}
      </p>
    );
  }

  const goalItems = plan.items.filter((item) => item.targetYen > 0);
  const budgetYen = goalItems.reduce((sum, item) => sum + item.targetYen, 0);
  const endLabel = dayLabel(plan.periodEnd);
  const remainingDays = Math.max(0, daysBetween(today, plan.periodEnd) + 1);

  const rows = landingRowsFrom({
    forecast,
    excludedByCategory: outcome.ok ? outcome.value.excludedByCategory : new Map(),
    closedGenreIds,
    cautionPrecision: outcome.ok ? outcome.value.cautionPrecision : null,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const fixedRows = rows.filter((row) => row.group === 'fixed');
  const fixedIds = new Set(fixedRows.map((row) => row.genreId));
  const fixedYen = fixedRows.reduce((sum, row) => sum + row.p50, 0);

  // グラフの線(期間の明細を、カテゴリごとに組み立てる)。
  const txs = loaded.transactions.map((tx) => ({ ...tx, items: [] }));
  const linesOf = (keys: readonly string[]) =>
    linesForGoal(
      keys.flatMap((key) => buildCategoryLines(txs, key, period, today)),
      period,
    );
  const allKeys = [
    ...new Set([
      ...genres.map((g) => g.id),
      ...loaded.transactions.flatMap((tx) => [tx.genreId, ...tx.splits.map((sp) => sp.genreId)]),
    ]),
  ].map((id) => id ?? UNCATEGORIZED_KEY);
  const remaining = remainingOfTotal(forecast);
  const cumulative = (keys: readonly string[], budget: number, rem: typeof remaining) =>
    buildCumulative({
      lines: linesOf(keys),
      monthStart: period.from,
      monthEnd: period.to,
      today,
      recordStart: period.from,
      goal: { range: period, budgetYen: budget },
      remaining: rem,
    }).days;
  const spentOf = (days: ScopeData['days']) => {
    let spent = 0;
    for (const d of days) if (d.actualYen !== null) spent = d.actualYen;
    return spent;
  };
  const allDays = cumulative(allKeys, budgetYen, remaining);
  const all: ScopeData = {
    budgetYen,
    p10: forecast.total.p10,
    p50: forecast.total.p50,
    p90: forecast.total.p90,
    days: allDays,
    spentYen: spentOf(allDays),
  };
  const changeableItems = goalItems.filter((item) => !fixedIds.has(item.genreId));
  const changeableBudget = changeableItems.reduce((sum, item) => sum + item.targetYen, 0);
  let changeable: ScopeData | null = null;
  if (fixedIds.size > 0 && changeableBudget > 0) {
    const days = cumulative(
      allKeys.filter((key) => !fixedIds.has(key)),
      changeableBudget,
      withoutScheduled(remaining, linesOf([...fixedIds])),
    );
    changeable = {
      budgetYen: changeableBudget,
      p10: Math.max(0, forecast.total.p10 - fixedYen),
      p50: Math.max(0, forecast.total.p50 - fixedYen),
      p90: Math.max(0, forecast.total.p90 - fixedYen),
      days,
      spentYen: spentOf(days),
    };
  }

  // 最近の勢い:1日ごとの支出(固定費をのぞく)。
  const daySpend: Record<string, number> = {};
  for (const tx of loaded.transactions) {
    if (tx.occurredOn > today) continue;
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    if (
      tx.mustPay ||
      (tx.genreId !== null && (closedGenreIds.has(tx.genreId) || fixedIds.has(tx.genreId)))
    )
      continue;
    daySpend[tx.occurredOn] = (daySpend[tx.occurredOn] ?? 0) + -tx.amountYen;
  }
  const variableSpent = Object.entries(daySpend)
    .filter(([date]) => date >= period.from)
    .reduce((sum, [, yen]) => sum + yen, 0);
  const days = Math.max(1, periodDays(plan.periodStart, plan.periodEnd));
  const variableBudget = Math.max(0, budgetYen - fixedYen);

  // AIの気づき:AIの分析があればその箇条書き、無ければ記録から決まる気づき。
  const previousMonthKey = trend?.monthKeys.filter((key) => key < monthKey).at(-1);
  const previousByGenre =
    trend && previousMonthKey !== undefined
      ? new Map(
          trend.rows
            .filter((row) => row.monthKey === previousMonthKey)
            .map((row) => [row.categoryId, row.spentYen] as const),
        )
      : undefined;
  const fallback = reportInsights({
    forecast,
    budgetYen,
    periodLabel: '今期',
    ...(previousByGenre ? { previousByGenre, previousLabel: '先月' } : {}),
  }).map((insight) => insight.text);
  const bullets = report && report.insights.length > 0 ? report.insights : fallback;

  const unset = genres.filter(
    (g) => !closedGenreIds.has(g.id) && !goalItems.some((item) => item.genreId === g.id),
  ).length;

  return (
    <>
      <ForecastHero
        all={all}
        changeable={changeable}
        endLabel={endLabel}
        remainingDays={remainingDays}
      />
      {forecast.probWithinBudget !== null ? (
        <ProbabilityCard
          p10={forecast.total.p10}
          p50={forecast.total.p50}
          p90={forecast.total.p90}
          budgetYen={budgetYen}
          probWithin={forecast.probWithinBudget}
        />
      ) : null}
      <WhyCard forecast={forecast} closedGenreIds={closedGenreIds} />
      {today >= period.from ? (
        <MomentumCard
          daySpend={daySpend}
          fixedYen={fixedYen}
          from={period.from}
          today={today < period.to ? today : period.to}
          budgetPerDayYen={variableBudget > 0 ? Math.round(variableBudget / days) : null}
          remainingPerDayYen={
            variableBudget > 0 && remainingDays > 0
              ? Math.round(Math.max(0, variableBudget - variableSpent) / remainingDays)
              : null
          }
        />
      ) : null}
      <AiCard
        asOfLabel={report ? `${dayLabel(report.createdAt.slice(0, 10))}時点` : null}
        bullets={bullets}
        analyzed={report !== null}
      />
      <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)' }}>
        {fixedRows.length > 0 ? (
          <>
            <ListRow
              href="/spending#fixed-costs"
              title="固定費"
              sub={`${fixedRows.map((row) => row.name).join('、')} · 見込みに含む`}
              value={formatYen(fixedYen, { sign: 'never' })}
            />
            <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />
          </>
        ) : null}
        <ListRow
          href="/plan/edit"
          title="カテゴリごとの予算"
          value={unset > 0 ? `${unset}件が未設定` : 'すべて設定済み'}
          muted
        />
      </div>
    </>
  );
}

function ListRow({
  href,
  title,
  sub,
  value,
  muted = false,
}: {
  href: string;
  title: string;
  sub?: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <Link
      href={href as Route}
      className="flex min-h-14 items-center gap-3 px-4"
      style={{ color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className="text-[16px]">{title}</span>
        {sub ? (
          <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </span>
        ) : null}
      </span>
      <span
        className={`tabular shrink-0 ${muted ? 'text-[15px]' : 'text-[16px]'}`}
        style={{ color: muted ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}
      >
        {value}
      </span>
      <span style={{ color: 'var(--ideal)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
