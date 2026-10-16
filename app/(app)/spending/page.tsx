import { getCurrentPlan } from '@/features/spending-plan/store';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { listDuplicateCandidates } from '@/features/transactions/duplicates-store';
import { AttentionCard } from './attention-card';
import { CalendarHeatmap } from './calendar-heatmap';
import { LedgerList, LedgerSearch } from './ledger-list';
import { loadSpendingMonthData } from './month-data';
import { MonthSummary } from './month-summary';
import { PeriodSwitcher } from './period-switcher';
import { SpendingMonthProvider } from './spending-month-provider';

/**
 * 明細(デザイン仕様書の「明細」、ADR-090)。上から次の順に並べる:
 *   1. 見出しと月の切り替え(‹ 10月 ›)
 *   2. 支出・収入・差額
 *   3. 検索(店名・品目・メモ)
 *   4. カレンダー(週 ↔ 月。日付タップで明細を絞り込む)
 *   5. 確認が要る記録・入力待ちのレシート
 *   6. 予定 → この月の固定費 → 日付ごとの明細
 * カテゴリ・回数と1回の金額・1年の流れは「分析」へ移した。
 *
 * どの数字も domain/ledger.ts の集計関数の値(features/spending/views.ts 経由)で、
 * 同じ期間なら全部の合計が一致する。ADR-061 参照。
 */

// 取り込み直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [data, duplicates, fixedKeys] = await Promise.all([
    loadSpendingMonthData(),
    listDuplicateCandidates(),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
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
        <CalendarHeatmap />
        <AttentionCard hasGoal={plan !== null} />
        <LedgerList
          goalRange={null}
          duplicateCount={duplicates.length}
          fixedKeys={[...fixedKeys]}
        />
      </SpendingMonthProvider>
    </div>
  );
}
