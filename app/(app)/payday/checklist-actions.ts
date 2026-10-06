'use server';

/**
 * 給料日チェックリストの Server Action(M4-4)。
 */

import { revalidatePath } from 'next/cache';

import { MoneyError, assertYen, parseYen } from '@/domain/money';
import { createPaydayRun, setTransferRunItemDone } from '@/features/transfer-runs/store';
import { describeUserError } from '@/lib/errors';

export type PaydayChecklistFormState = {
  error: string | null;
};

export async function createPaydayRunAction(
  paydayOn: string,
  _prev: PaydayChecklistFormState,
  formData: FormData,
): Promise<PaydayChecklistFormState> {
  try {
    const amount = assertYen(parseYen(String(formData.get('sourceAmountYen') ?? '')), '入金額');
    if (amount <= 0) {
      throw new MoneyError(`入金額は正の値で指定してください: ${amount}`);
    }
    await createPaydayRun(amount, paydayOn);
  } catch (error) {
    return { error: describeUserError(error) };
  }
  revalidatePath('/payday');
  return { error: null };
}

export async function toggleTransferRunItemAction(itemId: string, isDone: boolean): Promise<void> {
  await setTransferRunItemDone(itemId, isDone);
  revalidatePath('/payday');
}
