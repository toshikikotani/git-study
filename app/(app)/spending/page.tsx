import { paceComparison, canShowForecast, hasIncome } from '@/domain/summary-rules';
import { loadAccumulationView } from '@/features/accumulation/store';
import { listAccounts } from '@/features/accounts/store';
import { loadGoalView } from '@/features/goals/loader';
import { loadSpendingDiagnosisView } from '@/features/diagnosis/store';
import { listGenres } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadMonthlyLedger } from '@/features/spending/store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { addMonths } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { AttentionCard } from './attention-card';
import { CalendarHeatmap } from './calendar-heatmap';
import { CurrentMonthOnly } from './current-month-only';
import { toDrilldownTransactions } from './drilldown';
import { GenreBreakdown } from './genre-breakdown';
import { GoalCard } from '../plan/goal-card';
import { buildGoalCard } from '@/features/goals/card';
import { InsightsCard } from './insights-card';
import { LedgerList } from './ledger-list';
import { PeriodSwitcher } from './period-switcher';
import { SpendingMonthProvider } from './spending-month-provider';
import { SubscriptionsCard } from './subscriptions-card';
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
  const [ledger, genres, accounts, duplicates, diagnosis, pile, subscriptions, loadedGoal] =
    await withMinDuration(
      Promise.all([
        loadMonthlyLedger(),
        listGenres(),
        listAccounts(),
        listDuplicateCandidates(),
        loadSpendingDiagnosisView(),
        loadAccumulationView(),
        loadDetectedSubscriptions(),
        loadGoalView(),
      ]),
    );
  const ids = ledger.transactions.map((t) => t.id);
  const [items, subtypes] = await Promise.all([
    listReceiptItemsForTransactionIds(ids),
    listExpenseSubtypesForTransactionIds(ids),
  ]);
  const transactions = toDrilldownTransactions(ledger.transactions, items, subtypes);

  const today = ledger.period.to;
  // 目標期間中だけ、サマリー・内訳・カレンダー・リストを目標と連動させる。
  const goal = loadedGoal !== null && loadedGoal.view.active ? loadedGoal.view : null;
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
      >
        <PeriodSwitcher />
        <SummaryCard
          pace={pace}
          forecast={forecast}
          hasIncomeRegistered={hasIncome(ledger.totals.incomeYen)}
          goal={goal ? <GoalCard model={buildGoalCard(goal, today)} /> : null}
        />
        <AttentionCard hasGoal={goal !== null} />
        <GenreBreakdown goalRows={goal ? goal.breakdown : null} />
        <CalendarHeatmap
          goal={goal ? { range: goal.range, dailyAllowanceYen: goal.dailyAllowanceYen } : null}
        />
        <LedgerList goalRange={goal ? goal.range : null} duplicateCount={duplicates.length} />
        <CurrentMonthOnly>
          <InsightsCard
            view={diagnosis}
            totalSpentYen={ledger.totals.spentYen}
            pile={{ thresholdYen: pile.thresholdYen, smallSpendTotalYen: pile.smallSpendTotalYen }}
          />
          <div className="mt-3">
            <SubscriptionsCard subscriptions={subscriptions} />
          </div>
        </CurrentMonthOnly>
      </SpendingMonthProvider>
    </div>
  );
}
