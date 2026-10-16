import type { Route } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { GenreBreakdown } from '../../spending/genre-breakdown';
import { loadSpendingMonthData } from '../../spending/month-data';
import { PeriodSwitcher } from '../../spending/period-switcher';
import { SpendingMonthProvider } from '../../spending/spending-month-provider';
import { AnalysisSummary } from '../analysis-summary';
import { AnalysisTabs } from '../analysis-tabs';
import { frequencyPoints, frequencySummary } from '../frequency';
import { YearFlowCard } from '../year-flow-card';

/**
 * 分析 › 月のふりかえり(デザイン仕様書の「4b」、ADR-091):何に使ったか。月の切り替え → 支出・収入・
 * 貯蓄率 → カテゴリ → 1年の流れ → 回数と1回の金額・月ごとの表・AIレポート。
 * そのほかの分析(固定費の候補・お店・資産・予測の当たり具合)は「…」の「そのほかの分析」へ。
 */
export const dynamic = 'force-dynamic';

export default async function MonthReviewPage() {
  const data = await loadSpendingMonthData();
  const summary = frequencySummary(frequencyPoints(data.ledger.transactions));

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
      >
        <PeriodSwitcher title="分析" />
        <AnalysisTabs current="month" />
        <AnalysisSummary />
        <GenreBreakdown />
      </SpendingMonthProvider>
      <Suspense fallback={null}>
        <YearFlowCard />
      </Suspense>
      <nav
        aria-label="ほかの分析"
        className="overflow-hidden rounded-2xl"
        style={{ background: 'var(--surface)' }}
      >
        <Row href="/reports/frequency" title="回数と1回の金額" sub={summary} />
        <Divider />
        <Row href="/reports/monthly" title="月ごとの表" />
        <Divider />
        <Row href="/reports/ai" title="日次・月次のAIレポート" />
      </nav>
    </div>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

function Row({ href, title, sub }: { href: string; title: string; sub?: string | null }) {
  return (
    <Link
      href={href as Route}
      className="flex min-h-14 items-center gap-3 px-4"
      style={{ color: 'var(--ink)' }}
    >
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className="text-[16px]">{title}</span>
        {sub ? (
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </span>
        ) : null}
      </span>
      <span style={{ color: 'var(--ideal)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
