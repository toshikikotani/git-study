import { Suspense } from 'react';

import { resolveCalendarMonthStart } from '@/lib/period-nav';
import { GenreBreakdown } from '../../spending/genre-breakdown';
import { loadSpendingMonthData } from '../../spending/month-data';
import { PeriodSwitcher } from '../../spending/period-switcher';
import { SpendingMonthProvider } from '../../spending/spending-month-provider';
import { AnalysisSummary } from '../analysis-summary';
import { AnalysisTabs } from '../analysis-tabs';
import { YearFlowCard } from '../year-flow-card';
import { MonthAnalysisLinks } from './month-analysis-links';

/**
 * 分析 › 月のふりかえり(デザイン仕様書の「4b」、ADR-091):何に使ったか。月の切り替え → 支出・収入・
 * 貯蓄率 → カテゴリ → 1年の流れ → 回数と1回の金額・月ごとの表・AIレポート。
 * そのほかの分析(固定費の候補・お店・資産・予測の当たり具合)は「…」の「そのほかの分析」へ。
 */
export const dynamic = 'force-dynamic';

export default async function MonthReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string | string[] }>;
} = {}) {
  const data = await loadSpendingMonthData();
  const { month } = (await searchParams) ?? {};
  const initialMonth = resolveCalendarMonthStart(month, data.ledger.period.from);

  return (
    <div className="rise flex flex-col gap-4">
      <SpendingMonthProvider
        today={data.ledger.period.to}
        currentMonthStart={data.ledger.period.from}
        currentTransactions={data.transactions}
        currentGenreBreakdown={data.ledger.genreBreakdown}
        currentTotals={data.ledger.totals}
        genres={data.genres}
        accounts={data.accounts}
        captures={data.captures}
        initialMonth={initialMonth}
      >
        <PeriodSwitcher title="分析" />
        <AnalysisTabs current="month" />
        <AnalysisSummary />
        <GenreBreakdown />
        <Suspense fallback={null}>
          <div className="space-y-2">
            <p className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              1年の流れは、今月までの直近12か月です。
            </p>
            <YearFlowCard />
          </div>
        </Suspense>
        <MonthAnalysisLinks />
      </SpendingMonthProvider>
    </div>
  );
}
