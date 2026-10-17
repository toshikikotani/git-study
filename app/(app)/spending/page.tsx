import { cookies } from 'next/headers';
import Link from 'next/link';

import { getCurrentPlan } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { CALENDAR_VIEW_COOKIE, parseCalendarView } from '@/lib/calendar-view';
import { AttentionCard } from './attention-card';
import { CalendarHeatmap } from './calendar-heatmap';
import { LedgerList, LedgerSearch } from './ledger-list';
import { loadSpendingMonthData } from './month-data';
import { MonthSummary } from './month-summary';
import { PeriodSwitcher } from './period-switcher';
import { SpendingMonthProvider } from './spending-month-provider';
import { PendingReviewPage } from './pending-review-page';

/**
 * 明細(デザイン仕様書の「明細」、ADR-090)。上から次の順に並べる:
 *   1. 見出しと月の切り替え(‹ 10月 ›)
 *   2. 支出・収入・差額
 *   3. 検索(店名・品目・メモ)
 *   4. カレンダー(週 ↔ 月。選んだ表示は覚えておく(ADR-093)。日付タップで明細を絞り込む)
 *   5. 確認が要る記録・入力待ちのレシート
 *   6. 予定 → この月の固定費 → 日付ごとの明細
 * カテゴリ・回数と1回の金額・1年の流れは「分析」へ移した。
 *
 * どの数字も domain/ledger.ts の集計関数の値(features/spending/views.ts 経由)で、
 * 同じ期間なら全部の合計が一致する。ADR-061 参照。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage({
  searchParams,
}: {
  searchParams?: Promise<{ review?: string }>;
}) {
  const query = await searchParams;
  if (query?.review === 'input' || query?.review === 'category') {
    return <PendingReviewPage kind={query.review} />;
  }
  const [data, duplicates, fixedKeys, jar] = await Promise.all([
    loadSpendingMonthData(),
    listDuplicateCandidates(),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    cookies(),
  ]);
  const today = data.ledger.period.to;
  const plan = await getCurrentPlan(today).catch(() => null);

  return (
    <div className="rise flex flex-col gap-4">
      <SpendingMonthProvider
        today={today}
        currentMonthStart={data.ledger.period.from}
        currentTransactions={data.transactions}
        currentGenreBreakdown={data.ledger.genreBreakdown}
        currentTotals={data.ledger.totals}
        genres={data.genres}
        accounts={data.accounts}
        captures={data.captures}
      >
        <PeriodSwitcher />
        <MonthSummary />
        <LedgerSearch />
        <CalendarHeatmap initialView={parseCalendarView(jar.get(CALENDAR_VIEW_COOKIE)?.value)} />
        <AttentionCard hasGoal={plan !== null} />
        <nav
          aria-label="明細の確認と管理"
          className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <Link href="/spending?review=input" className="flex min-h-11 items-center">
            入力待ち
          </Link>
          <Link href="/spending?review=category" className="flex min-h-11 items-center">
            カテゴリ確認待ち
          </Link>
          <Link href="/transactions/reconcile" className="flex min-h-11 items-center">
            請求突合
          </Link>
          <Link href="/transactions/duplicates" className="flex min-h-11 items-center">
            重複の確認
          </Link>
          <Link href="/accounts" className="flex min-h-11 items-center">
            口座
          </Link>
        </nav>
        <LedgerList
          goalRange={null}
          duplicateCount={duplicates.length}
          fixedKeys={[...fixedKeys]}
        />
      </SpendingMonthProvider>
    </div>
  );
}
