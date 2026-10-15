import Link from 'next/link';

import { CategoryTrendChart } from './category-trend-chart';
import { VerificationCard } from './verification-card';
import { loadForecast } from '@/features/forecast/load';
import { addDays, addMonths } from '@/lib/date';
import { FixedVariableCard } from './fixed-variable-card';
import { MerchantRankingCard } from './merchant-ranking-card';
import { MonthSummaryRow } from './month-summary-row';
import { NetWorthChart } from './net-worth-chart';
import { PurposeBalanceCard } from './purpose-balance-card';
import { hasIncome } from '@/domain/summary-rules';
import {
  loadAccountBalanceByPurpose,
  loadCategorySpendingTrend,
  loadMerchantSpendingRanking,
} from '@/features/reports/store';
import { loadNetWorthTrend } from '@/features/net-worth/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { withMinDuration } from '@/lib/min-loading-duration';

/**
 * レポート(振り返り)。着地の見込み・カテゴリごとの見込み・なぜ・AIの分析は「予算」へ移した(ADR-088)。
 * カテゴリの割合・回数と1回の金額・1年の流れは「家計簿」へ移した(ADR-089)。
 * ここには、今月の収支・固定費の確認・カテゴリの推移・お店・資産・予測の検証を置く。
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function ReportsPage() {
  const [
    trend,
    netWorthPoints,
    merchantRanking,
    purposeBalances,
    ledger,
    fixedVariable,
    subscriptionCandidates,
    confirmedKeys,
  ] = await withMinDuration(
    Promise.all([
      loadCategorySpendingTrend(),
      loadNetWorthTrend().catch(() => []),
      loadMerchantSpendingRanking(),
      loadAccountBalanceByPurpose(),
      loadMonthlyLedger(),
      loadFixedVariableSplit(),
      loadDetectedSubscriptions(),
      listConfirmedFixedCostKeys(),
    ]),
  );
  const monthPeriod = {
    from: ledger.period.from,
    to: addDays(addMonths(ledger.period.from, 1), -1),
  };
  // 今月の収支の見込みと、予測の当たり具合(検証)だけは今月の予測から出す。
  const outcome = await loadForecast({ period: monthPeriod }).catch((error: unknown) => {
    console.error('[reports] 今月の予測を読み込めませんでした', error);
    return null;
  });

  return (
    <div className="rise space-y-4">
      <header className="space-y-1 px-1">
        <h1
          className="text-[34px] leading-none font-bold tracking-[-0.03em]"
          style={{ color: 'var(--ink)' }}
        >
          レポート
        </h1>
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          着地の見込みとカテゴリごとの様子は「予算」へ
        </Link>
      </header>

      <MonthSummaryRow
        spentYen={ledger.totalSpentYen}
        incomeYen={ledger.totalIncomeYen}
        incomeRegistered={hasIncome(ledger.totalIncomeYen)}
        balance={outcome?.forecast.balance ?? null}
      />

      <FixedVariableCard
        fixedYen={fixedVariable.fixedYen}
        variableYen={fixedVariable.variableYen}
        candidates={subscriptionCandidates}
        confirmedKeys={[...confirmedKeys]}
      />

      {trend.categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          直近6ヶ月に支出の記録がありません。
        </p>
      ) : (
        <CategoryTrendChart trend={trend} />
      )}

      <Link
        href="/reports/genres"
        className="flex min-h-11 items-center text-xs font-medium"
        style={{ color: 'var(--accent)' }}
      >
        AIによる客観的なカテゴリで見る →
      </Link>

      <MerchantRankingCard ranking={merchantRanking} />

      <NetWorthChart points={netWorthPoints} />

      <PurposeBalanceCard balances={purposeBalances} />

      {outcome ? (
        <VerificationCard verification={outcome.verification} monthStart={ledger.period.from} />
      ) : null}
    </div>
  );
}
