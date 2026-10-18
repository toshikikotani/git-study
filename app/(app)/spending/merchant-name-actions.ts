'use server';

import { revalidatePath } from 'next/cache';

import {
  saveMerchantNameChanges,
  type MerchantNameSaveResult,
} from '@/features/transactions/merchant-name-store';
import { describeUserError } from '@/lib/errors';

export async function saveMerchantNameChangesAction(
  input: unknown,
): Promise<MerchantNameSaveResult> {
  try {
    const result = await saveMerchantNameChanges(input);
    if (result.updatedIds.length > 0) {
      revalidatePath('/spending');
      revalidatePath('/spending/review');
      revalidatePath('/transactions');
      revalidatePath('/');
    }
    return result;
  } catch (error) {
    return {
      updatedIds: [],
      failed: [],
      error: describeUserError(error, '店名を保存できませんでした。もう一度お試しください。'),
    };
  }
}
