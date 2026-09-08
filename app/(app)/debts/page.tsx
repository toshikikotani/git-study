import { listDebts, toPayoffDebt } from '@/features/debts/store';
import { getAppSettings } from '@/features/settings/store';
import { DebtRow } from './debt-row';
import { NewDebt } from './new-debt';
import { PayoffSimulation } from './payoff-simulation';

/**
 * 負債一覧・登録・編集(FR-01, M1-2)。
 *
 * ADR-006:シードの3件には is_estimated = true が付いている。本人が
 * 「編集」から実際の値へ直すたびに false へ落ち、全件 false になって
 * 初めて完済予定日を確定値として出せるようになる(ホーム画面側の話)。
 */

// 残高は常に最新でなければならない。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function DebtsPage() {
  const [debts, settings] = await Promise.all([listDebts(), getAppSettings()]);

  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          負債
        </h1>
      </header>

      {debts.length === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          まだ登録されていません。下のボタンから追加してください。
        </p>
      ) : (
        <div className="space-y-3">
          {debts.map((debt) => (
            <DebtRow key={debt.id} debt={debt} />
          ))}
        </div>
      )}

      <NewDebt />

      <PayoffSimulation
        debts={debts.map(toPayoffDebt)}
        initialMonthlyBudgetYen={settings.monthlyRepaymentTargetYen}
        initialStrategy={settings.repaymentStrategy}
      />
    </div>
  );
}
