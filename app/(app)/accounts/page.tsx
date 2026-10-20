import { BackHeader } from '@/components/ui/back-header';
import { listAccounts } from '@/features/accounts/store';
import { loadNetWorthTrend } from '@/features/net-worth/store';
import { loadAccountBalanceByPurpose } from '@/features/reports/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { NetWorthChart } from '../reports/net-worth-chart';
import { PurposeBalanceCard } from '../reports/purpose-balance-card';
import { AccountRow } from './account-row';
import { NewAccount } from './new-account';

/**
 * 口座(カード)の登録・編集(M6-1)。設定から開く。
 *
 * どのカード・銀行で使ったかを追える土台。取り込み時にここで登録した
 * 口座を選ぶ(M6-2)ことで、初めて口座別の集計・請求突合(M6-4)が成立する。
 * 資産の推移と口座の目的ごとの残高もここで見る(もとは「そのほかの分析」、ADR-127)。
 */

// 一覧は常に最新でなければならない。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const [accounts, netWorth, balances] = await withMinDuration(
    Promise.all([
      listAccounts(),
      loadNetWorthTrend().catch(() => []),
      loadAccountBalanceByPurpose().catch(() => []),
    ]),
  );

  return (
    <div className="rise space-y-4">
      <BackHeader back={{ href: '/settings', label: '設定' }} title="口座" />

      {accounts.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          まだ登録されていません。下のボタンから追加してください。
        </p>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </div>
      )}

      <NewAccount />

      <NetWorthChart points={netWorth} />
      <PurposeBalanceCard balances={balances} />
    </div>
  );
}
