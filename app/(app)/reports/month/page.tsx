import { Suspense } from 'react';

import { resolveCalendarMonthStart } from '@/lib/period-nav';
import { GenreBreakdown } from '../../spending/genre-breakdown';
import { loadSpendingMonthData } from '../../spending/month-data';
import { PeriodSwitcher } from '../../spending/period-switcher';
import { SpendingMonthProvider } from '../../spending/spending-month-provider';
import { AnalysisSummary } from '../analysis-summary';
import { AnalysisTabs } from '../analysis-tabs';
import { loadMerchantSpendingRanking } from '@/features/reports/store';
import { MerchantRankingCard } from '../merchant-ranking-card';
import { YearFlowCard } from '../year-flow-card';
import { AiReportLink } from './ai-report-link';
import { FrequencyCard } from './frequency-card';
import { SmallSpendCard } from './small-spend-card';

/**
 * 分析 › 月のふりかえり(デザイン仕様書の「4b」、ADR-091):何に使ったか。月の切り替え → 支出・収入・
 * 貯蓄率 → AIのレポート(ADR-128)→ カテゴリ → 回数と1回の金額 → お店 → 小口(ちりつも)→ 1年の流れ
 * (「表で見る」で月ごとの表)。
 * 分析を浅くするため、別の画面に分かれていたもの(回数・月ごとの表・ちりつも・お店)をカードにした
 * (どれもタブから2回で届く、ADR-127)。
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
        <AiReportLink />
        <GenreBreakdown />
        <FrequencyCard />
        <Suspense fallback={null}>
          <MerchantRanking />
        </Suspense>
        <Suspense fallback={null}>
          <SmallSpendCard />
        </Suspense>
        <Suspense fallback={null}>
          <div className="space-y-2">
            <p className="px-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              1年の流れは、今月までの直近12か月です。
            </p>
            <YearFlowCard />
          </div>
        </Suspense>
      </SpendingMonthProvider>
    </div>
  );
}

/** お店ごとの支出(直近の数か月、金額の多い順。もとは「そのほかの分析」)。 */
async function MerchantRanking() {
  const ranking = await loadMerchantSpendingRanking().catch(() => null);
  return ranking ? <MerchantRankingCard ranking={ranking} /> : null;
}
