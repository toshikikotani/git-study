import { listAccounts } from '@/features/accounts/store';
import { AccountRow } from './account-row';
import { NewAccount } from './new-account';

/**
 * 口座(カード)の登録・編集(M6-1)。
 *
 * どのカード・銀行で使ったかを追える土台。取り込み時にここで登録した
 * 口座を選ぶ(M6-2)ことで、初めて口座別の集計・請求突合(M6-4)が成立する。
 */

// 一覧は常に最新でなければならない。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const accounts = await listAccounts();

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          口座
        </h1>
      </header>

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
    </div>
  );
}
