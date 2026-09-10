import Link from 'next/link';

import { computePlanActualDelta, type PlanActualDelta } from '@/domain/debt-payment';
import { simulateDebtPayoff } from '@/domain/payoff';
import { listDebtPayments, type DebtPayment } from '@/features/debts/payments-store';
import { listDebts, toPayoffDebt, type Debt } from '@/features/debts/store';
import { listRefinanceScenarios } from '@/features/scenarios/store';
import { getAppSettings } from '@/features/settings/store';
import { DebtRow } from './debt-row';
import { NewDebt } from './new-debt';
import { PayoffSimulation } from './payoff-simulation';
import { RefinanceSimulation } from './refinance-simulation';

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
  const [debts, settings, scenarios] = await Promise.all([
    listDebts(),
    getAppSettings(),
    listRefinanceScenarios(),
  ]);

  const paymentsByDebt = await Promise.all(debts.map((debt) => listDebtPayments(debt.id)));

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
          {debts.map((debt, index) => (
            <DebtRow
              key={debt.id}
              debt={debt}
              payments={paymentsByDebt[index]!}
              planActualDelta={computePlanActualDeltaSafely(debt, paymentsByDebt[index]!)}
            />
          ))}
        </div>
      )}

      <NewDebt />

      <PayoffSimulation
        debts={debts.map(toPayoffDebt)}
        initialMonthlyBudgetYen={settings.monthlyRepaymentTargetYen}
        initialStrategy={settings.repaymentStrategy}
      />

      <RefinanceSimulation
        debts={debts.map(toPayoffDebt)}
        monthlyBudgetYen={settings.monthlyRepaymentTargetYen}
        strategy={settings.repaymentStrategy}
        scenarios={scenarios}
      />

      <Link
        href="/investments"
        className="block text-center text-[13px] font-medium"
        style={{ color: 'var(--accent)' }}
      >
        返済と並走する投資額を見る →
      </Link>
    </div>
  );
}

/**
 * 計画との差分を計算する。当初元本が未入力(originalPrincipalYen が null)だと
 * 計画の起点が定まらないため、その場合は差分を出さない(誤解を招く数字より
 * 何も出さない方がよい)。金利設定が原因でシミュレーションが完済しない
 * (PayoffError)場合も同様に差分を諦める — /debts 画面全体を落とすほどの話ではない。
 */
function computePlanActualDeltaSafely(
  debt: Debt,
  payments: readonly DebtPayment[],
): PlanActualDelta | null {
  if (payments.length === 0) return null;
  if (debt.originalPrincipalYen === null || debt.originalPrincipalYen <= 0) return null;

  try {
    const planRows = simulateDebtPayoff(
      {
        id: debt.id,
        balanceYen: debt.originalPrincipalYen,
        annualRate: debt.annualRate,
        minimumPaymentYen: debt.minimumPaymentYen,
        paymentDay: debt.paymentDay,
      },
      debt.minimumPaymentYen,
    );
    return computePlanActualDelta(planRows, payments.length, debt.currentBalanceYen);
  } catch {
    return null;
  }
}
