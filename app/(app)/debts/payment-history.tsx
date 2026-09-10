'use client';

import { useActionState, useState } from 'react';

import { formatYen } from '@/domain/money';
import type { PlanActualDelta } from '@/domain/debt-payment';
import type { DebtPayment } from '@/features/debts/payments-store';
import { formatDateJa, todayJst } from '@/lib/date';
import { recordDebtPaymentAction, type DebtPaymentFormState } from './payment-actions';

const INITIAL_STATE: DebtPaymentFormState = { error: null };

/** 返済実績の記録・一覧・計画との差分(M1-6、FR-05)。 */
export function PaymentHistory({
  debtId,
  payments,
  planActualDelta,
}: {
  debtId: string;
  payments: readonly DebtPayment[];
  planActualDelta: PlanActualDelta | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    recordDebtPaymentAction.bind(null, debtId),
    INITIAL_STATE,
  );

  return (
    <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium"
          style={{ color: 'var(--ink-secondary)' }}
        >
          返済実績({payments.length}件){open ? ' ▲' : ' ▼'}
        </button>
      </div>

      {planActualDelta ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          計画との差:
          {planActualDelta.deltaYen === 0
            ? '計画どおり'
            : planActualDelta.deltaYen > 0
              ? `計画より${formatYen(planActualDelta.deltaYen, { sign: 'never' })}多く残っています`
              : `計画より${formatYen(Math.abs(planActualDelta.deltaYen), { sign: 'never' })}進んでいます`}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-3">
          <form
            action={formAction}
            className="space-y-2 rounded-2xl border p-3"
            style={{ borderColor: 'var(--hairline)' }}
          >
            <div className="flex gap-2">
              <input
                type="date"
                name="paidOn"
                defaultValue={todayJst()}
                required
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
              <input
                type="text"
                inputMode="numeric"
                name="amountYen"
                placeholder="返済額(円)"
                required
                className="flex-1 rounded-xl px-3 py-2 text-sm"
                style={{
                  background: 'var(--plane)',
                  color: 'var(--ink)',
                  border: '1px solid var(--hairline)',
                }}
              />
            </div>
            <input
              type="text"
              name="note"
              placeholder="メモ(任意)"
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--plane)',
                color: 'var(--ink)',
                border: '1px solid var(--hairline)',
              }}
            />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {pending ? '記録中…' : '返済を記録する'}
            </button>
            {state.error ? (
              <p className="text-xs" style={{ color: 'var(--over)' }}>
                {state.error}
              </p>
            ) : null}
          </form>

          {payments.length > 0 ? (
            <ul className="space-y-1">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between text-xs"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span>{formatDateJa(payment.paidOn)}</span>
                  <span className="tabular">{formatYen(payment.amountYen, { sign: 'never' })}</span>
                  {payment.balanceAfterYen !== null ? (
                    <span className="tabular" style={{ color: 'var(--ink-muted)' }}>
                      残 {formatYen(payment.balanceAfterYen, { sign: 'never' })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              まだ記録がありません。
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
