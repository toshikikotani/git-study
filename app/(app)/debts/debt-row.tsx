'use client';

import { useState } from 'react';

import { Card } from '@/components/ui/card';
import type { PlanActualDelta } from '@/domain/debt-payment';
import { formatAnnualRate, formatYen } from '@/domain/money';
import type { DebtPayment } from '@/features/debts/payments-store';
import type { Debt } from '@/features/debts/store';
import { updateDebtAction } from './actions';
import { DebtForm } from './debt-form';
import { DEBT_KIND_LABELS } from './kind-labels';
import { PaymentHistory } from './payment-history';

/** 一覧の1件。読み取り表示と編集フォームをこの中で切り替える。 */
export function DebtRow({
  debt,
  payments,
  planActualDelta,
}: {
  debt: Debt;
  payments: readonly DebtPayment[];
  planActualDelta: PlanActualDelta | null;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <DebtForm
          action={updateDebtAction.bind(null, debt.id)}
          initial={debt}
          submitLabel="更新する"
          onDone={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {debt.lenderName}
            </h3>
            {/* ADR-006:推定値である間は必ずこのバッジを出す */}
            {debt.isEstimated ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--accent-track)', color: 'var(--accent)' }}
              >
                推定
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {DEBT_KIND_LABELS[debt.kind]} ・ 毎月{debt.paymentDay}日
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          編集
        </button>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Stat label="残高" value={formatYen(debt.currentBalanceYen, { sign: 'never' })} />
        <Stat label="年利" value={formatAnnualRate(debt.annualRate)} />
        <Stat label="最低返済額" value={formatYen(debt.minimumPaymentYen, { sign: 'never' })} />
      </dl>

      {debt.isEstimated ? (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          仮の値が入っています。実際の請求書を見ながら「編集」で正確な値に直してください。
        </p>
      ) : null}

      {debt.note ? (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {debt.note}
        </p>
      ) : null}

      <PaymentHistory debtId={debt.id} payments={payments} planActualDelta={planActualDelta} />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline" style={{ color: 'var(--ink-muted)' }}>
        {label}{' '}
      </dt>
      <dd className="tabular inline font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {value}
      </dd>
    </div>
  );
}
