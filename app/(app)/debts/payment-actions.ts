'use server';

/**
 * 返済実績記録の Server Action(M1-6)。
 */

import { revalidatePath } from 'next/cache';

import { MoneyError, assertYen, parseYen } from '@/domain/money';
import { recordDebtPayment } from '@/features/debts/payments-store';
import { assertDateOnly } from '@/lib/date';
import { describeUserError } from '@/lib/errors';

export type DebtPaymentFormState = {
  error: string | null;
};

export async function recordDebtPaymentAction(
  debtId: string,
  _prev: DebtPaymentFormState,
  formData: FormData,
): Promise<DebtPaymentFormState> {
  try {
    const amountYen = assertYen(parseYen(String(formData.get('amountYen') ?? '')), '返済額');
    if (amountYen <= 0) {
      throw new MoneyError(`返済額は正の値で指定してください: ${amountYen}`);
    }
    const paidOn = assertDateOnly(String(formData.get('paidOn') ?? ''));
    const noteRaw = String(formData.get('note') ?? '').trim();

    await recordDebtPayment(debtId, { paidOn, amountYen, note: noteRaw === '' ? null : noteRaw });
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/debts');
  return { error: null };
}
