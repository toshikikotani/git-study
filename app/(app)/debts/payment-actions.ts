'use server';

/**
 * 返済実績記録の Server Action(M1-6)。
 */

import { revalidatePath } from 'next/cache';

import { MoneyError, assertYen, parseYen } from '@/domain/money';
import { DebtPaymentStoreError, recordDebtPayment } from '@/features/debts/payments-store';
import { assertDateOnly } from '@/lib/date';

export type DebtPaymentFormState = {
  error: string | null;
};

function describeError(error: unknown): string {
  if (error instanceof MoneyError || error instanceof DebtPaymentStoreError) {
    return error.message;
  }
  return '保存に失敗しました。入力内容を確認してください。';
}

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
    return { error: describeError(error) };
  }
  revalidatePath('/debts');
  return { error: null };
}
