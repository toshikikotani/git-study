import { Suspense } from 'react';
import { paceComparison, canShowForecast, hasIncome } from '@/domain/summary-rules';
import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { addMonths } from '@/lib/date';
import { BubbleChart, type BubblePoint } from '../reports/bubble-chart';
import { AttentionCard } from './attention-card';
import { CalendarHeatmap } from './calendar-heatmap';
import { CurrentMonthOnly } from './current-month-only';
import { toDrilldownTransactions } from './drilldown';
import { GenreBreakdown } from './genre-breakdown';
import { OverviewChart } from './overview-chart';
import { OverviewChartSection } from './overview-chart-section';
import { LedgerList } from './ledger-list';
import { PeriodSwitcher } from './period-switcher';
import { ViewSwitch } from './view-switch';
import { SpendingMonthProvider } from './spending-month-provider';
import { LaterCards } from './later-cards';
import { SummaryCard } from './summary-card';
import { YearFlowSection } from './year-flow-section';

/**
 * 家計簿。上から次の順に並べる(依頼の情報構成):
 *   1. 期間の切り替え(‹ 9月 ›)
 *   2. 要確認カード(入力待ち・未分類・金額不一致。無ければ非表示)
 *   3. サマリー(支出・収入・今日まで、固定費と変えられる支出)
 *   4. カテゴリ別(ドーナツと一覧。上位5つと「ほかNカテゴリ」)
 *   5. 回数と1回の金額 → 1年の流れ(デザインの「家計簿」、ADR-089)
 *   6. カレンダー(ヒートマップ。週表示 ↔ 月表示。日付タップで明細を絞り込む)
 *   7. 明細リスト
 *   8. 気づき(AI診断とちりつもを小さくまとめる)
 *
 * どの数字も domain/ledger.ts の集計関数の値(features/spending/views.ts 経由)で、
 * 同じ期間なら全部の合計が一致する。ADR-061 参照。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [ledger, genres, accounts, duplicates, captures, fixedVariable, fixedKeys] =
    await Promise.all([
      loadMonthlyLedger(),
      listGenres(),
      listAccounts(),
      listDuplicateCandidates(),
      listOpenCaptures().catch(() => []),
      loadFixedVariableSplit().catch(() => null),
      listConfirmedFixedCostKeys().catch(() => new Set<string>()),
    ]);
  const plan = await getCurrentPlan(ledger.period.to).catch(() => null);
  // 目標があるときは目標のジャンルだけを全体の累計に入れる(総予算と同じ範囲)。
  const goalItems = plan ? plan.items.filter((item) => item.targetYen > 0) : [];
  const goalGenreIds = goalItems.length > 0 ? goalItems.map((item) => item.genreId) : null;
  const ids = ledger.transactions.map((t) => t.id);
  const [items, subtypes] = await Promise.all([
    listReceiptItemsForTransactionIds(ids),
    listExpenseSubtypesForTransactionIds(ids),
  ]);
  const transactions = toDrilldownTransactions(ledger.transactions, items, subtypes);

  // 回数と1回の金額(今月、カテゴリごと)。
  const bubbles = new Map<string, { name: string; count: number; total: number }>();
  for (const tx of ledger.transactions) {
    if (tx.amountYen >= 0 || tx.isTransfer || tx.reviewStatus === 'ignored' || tx.needsInput)
      continue;
    const name = tx.genreName ?? '未分類';
    const key = tx.genreId ?? name;
    const cur = bubbles.get(key) ?? { name, count: 0, total: 0 };
    cur.count += 1;
    cur.total += -tx.amountYen;
    bubbles.set(key, cur);
  }
  const bubblePoints: BubblePoint[] = [...bubbles.entries()].map(([id, g]) => ({
    genreId: id,
    name: g.name,
    frequency: g.count,
    avgYen: Math.round(g.total / g.count),
    totalYen: g.total,
  }));

  const today = ledger.period.to;
  const pace = paceComparison({
    today,
    firstRecordedOn: ledger.record.firstRecordedOn,
    lastMonthSameDay: addMonths(today, -1),
    dayOfMonth: ledger.pace.dayOfMonth,
    thisMonthToDateYen: ledger.pace.thisMonthToDateYen,
    lastMonthSameDayYen: ledger.pace.lastMonthSameDayYen,
  });
  const forecast = {
    projectedTotalYen: canShowForecast(ledger.record.recordedDaysThisMonth)
      ? ledger.forecast.projectedTotalYen
      : null,
    // ジャンルの月の目安は目標が無いときだけのもの。目標の期間中は合計と比べない。
    totalBudgetYen: goalGenreIds !== null ? null : ledger.forecast.totalBudgetYen,
  };

  const overviewProps = {
    transactions,
    genreIds: goalGenreIds ?? genres.map((genre) => genre.id),
    monthStart: ledger.period.from,
    monthEnd: ledger.period.to,
    today,
    budgetYen: goalGenreIds ? goalItems.reduce((sum, item) => sum + item.targetYen, 0) : null,
    goalFrom: plan?.periodStart ?? null,
    goalTo: plan?.periodEnd ?? null,
  };

  return (
    <div className="rise space-y-3">
      <SpendingMonthProvider
        today={today}
        currentMonthStart={ledger.period.from}
        currentTransactions={transactions}
        currentGenreBreakdown={ledger.genreBreakdown}
        currentTotals={ledger.totals}
        genres={genres}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        captures={captures}
      >
        <PeriodSwitcher />
        <ViewSwitch />
        <AttentionCard hasGoal={goalGenreIds !== null} />
        <SummaryCard
          pace={pace}
          forecast={forecast}
          hasIncomeRegistered={hasIncome(ledger.totals.incomeYen)}
          goal={null}
          fixedVariable={
            fixedVariable
              ? { fixedYen: fixedVariable.fixedYen, variableYen: fixedVariable.variableYen }
              : null
          }
        />
        <Suspense fallback={<OverviewChart {...overviewProps} holdForecast />}>
          <OverviewChartSection {...overviewProps} scopeGenreIds={goalGenreIds} />
        </Suspense>
        <GenreBreakdown goalRows={null} goalActive={goalGenreIds !== null} />
        <CurrentMonthOnly>
          <BubbleChart points={bubblePoints} />
        </CurrentMonthOnly>
        <Suspense fallback={null}>
          <YearFlowSection />
        </Suspense>
        <CalendarHeatmap goal={null} />
        <LedgerList
          goalRange={null}
          duplicateCount={duplicates.length}
          fixedKeys={[...fixedKeys]}
        />
        <CurrentMonthOnly>
          <Suspense fallback={null}>
            <LaterCards totalSpentYen={ledger.totals.spentYen} />
          </Suspense>
        </CurrentMonthOnly>
      </SpendingMonthProvider>
    </div>
  );
}
