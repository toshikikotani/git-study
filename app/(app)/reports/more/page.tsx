import type { Route } from 'next';
import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { loadForecast } from '@/features/forecast/load';
import { loadNetWorthTrend } from '@/features/net-worth/store';
import { loadAccountBalanceByPurpose, loadMerchantSpendingRanking } from '@/features/reports/store';
import { loadMonthlyLedger } from '@/features/spending/store';
import {
  listConfirmedFixedCostKeys,
  loadFixedVariableSplit,
} from '@/features/subscriptions/fixed-cost-store';
import { loadDetectedSubscriptions } from '@/features/subscriptions/store';
import { addDays, addMonths } from '@/lib/date';
import { LaterCards } from '../../spending/later-cards';
import { FixedVariableCard } from '../fixed-variable-card';
import { MerchantRankingCard } from '../merchant-ranking-card';
import { NetWorthChart } from '../net-worth-chart';
import { PurposeBalanceCard } from '../purpose-balance-card';
import { VerificationCard } from '../verification-card';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * そのほかの分析(「…」から開く、ADR-090)。デザイン仕様書の画面に無いが、なくさない分析:
 * 固定費と変えられる支出(定期の支払いの候補)・診断とちりつも・よく使うお店・資産・口座の目的・
 * 予測の当たり具合・AIのカテゴリ分析。
 */
export default async function MoreReportsPage() {
  const [ledger, fixedVariable, candidates, confirmedKeys, ranking, netWorth, balances] =
    await Promise.all([
      loadMonthlyLedger(),
      loadFixedVariableSplit(),
      loadDetectedSubscriptions(),
      listConfirmedFixedCostKeys(),
      loadMerchantSpendingRanking(),
      loadNetWorthTrend().catch(() => []),
      loadAccountBalanceByPurpose(),
    ]);
  const monthPeriod = {
    from: ledger.period.from,
    to: addDays(addMonths(ledger.period.from, 1), -1),
  };
  const outcome = await loadForecast({ period: monthPeriod }).catch(() => null);
  return (
    <div className="rise flex flex-col gap-4">
      <BackHeader
        back={{ href: '/reports/month', label: '月のふりかえり' }}
        title="そのほかの分析"
      />
      <FixedVariableCard
        fixedYen={fixedVariable.fixedYen}
        variableYen={fixedVariable.variableYen}
        candidates={candidates}
        confirmedKeys={[...confirmedKeys]}
      />
      <LaterCards totalSpentYen={ledger.totals.spentYen} />
      <MerchantRankingCard ranking={ranking} />
      <NetWorthChart points={netWorth} />
      <PurposeBalanceCard balances={balances} />
      {outcome ? (
        <VerificationCard verification={outcome.verification} monthStart={ledger.period.from} />
      ) : null}
      <Link
        href={'/reports/genres' as Route}
        className="flex min-h-11 items-center px-1 text-[15px] font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        AIによる客観的なカテゴリで見る
      </Link>
    </div>
  );
}
