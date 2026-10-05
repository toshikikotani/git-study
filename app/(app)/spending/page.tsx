import { Suspense } from 'react';
import { paceComparison, canShowForecast, hasIncome } from '@/domain/summary-rules';
import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { addMonths } from '@/lib/date';
import { AttentionCard } from './attention-card';
import { CalendarHeatmap } from './calendar-heatmap';
import { CurrentMonthOnly } from './current-month-only';
import { toDrilldownTransactions } from './drilldown';
import { GenreBreakdown } from './genre-breakdown';
import { OverviewChart } from './overview-chart';
import { LedgerList } from './ledger-list';
import { PeriodSwitcher } from './period-switcher';
import { ViewSwitch } from './view-switch';
import { SpendingMonthProvider } from './spending-month-provider';
import { LaterCards } from './later-cards';
import { SummaryCard } from './summary-card';

/**
 * 家計簿。上から次の順に並べる(依頼の情報構成):
 *   1. 期間の切り替え(‹ 9月 ›)
 *   2. サマリー(今月使った額と前月同日比。記録が少ないときは比較・予測・収入差額を出さない)
 *   3. 要確認カード(未分類・金額不一致。無ければ非表示)
 *   4. ジャンル内訳(積み上げバーと一覧。タップで明細を絞り込む)
 *   5. カレンダー(ヒートマップ。週表示 ↔ 月表示。日付タップで明細を絞り込む)
 *   6. 明細リスト
 *   7. 気づき(AI診断とちりつもを小さくまとめる)
 *
 * どの数字も domain/ledger.ts の集計関数の値(features/spending/views.ts 経由)で、
 * 同じ期間なら全部の合計が一致する。ADR-061 参照。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [ledger, genres, accounts, duplicates, captures] = await Promise.all([
    loadMonthlyLedger(),
    listGenres(),
    listAccounts(),
    listDuplicateCandidates(),
    listOpenCaptures().catch(() => []),
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
    totalBudgetYen: ledger.forecast.totalBudgetYen,
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
        <SummaryCard
          pace={pace}
          forecast={forecast}
          hasIncomeRegistered={hasIncome(ledger.totals.incomeYen)}
          goal={null}
        />
        <AttentionCard hasGoal={false} />
        <OverviewChart
          transactions={transactions}
          genreIds={goalGenreIds ?? genres.map((genre) => genre.id)}
          monthStart={ledger.period.from}
          monthEnd={ledger.period.to}
          today={today}
          budgetYen={goalGenreIds ? goalItems.reduce((sum, item) => sum + item.targetYen, 0) : null}
          goalFrom={plan?.periodStart ?? null}
          goalTo={plan?.periodEnd ?? null}
        />
        <GenreBreakdown goalRows={null} />
        <CalendarHeatmap goal={null} />
        <LedgerList goalRange={null} duplicateCount={duplicates.length} />
        <CurrentMonthOnly>
          <Suspense fallback={null}>
            <LaterCards totalSpentYen={ledger.totals.spentYen} />
          </Suspense>
        </CurrentMonthOnly>
      </SpendingMonthProvider>
    </div>
  );
}
