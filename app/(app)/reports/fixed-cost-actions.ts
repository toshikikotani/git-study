'use server';

import { revalidatePath } from 'next/cache';

import {
  confirmFixedCost,
  FixedCostStoreError,
  unconfirmFixedCost,
} from '@/features/subscriptions/fixed-cost-store';

export async function confirmFixedCostAction(
  subscriptionKey: string,
): Promise<{ error: string | null }> {
  try {
    await confirmFixedCost(subscriptionKey);
  } catch (error) {
    return {
      error: error instanceof FixedCostStoreError ? error.message : '登録できませんでした。',
    };
  }
  revalidatePath('/reports');
  return { error: null };
}

export async function unconfirmFixedCostAction(
  subscriptionKey: string,
): Promise<{ error: string | null }> {
  try {
    await unconfirmFixedCost(subscriptionKey);
  } catch (error) {
    return {
      error: error instanceof FixedCostStoreError ? error.message : '解除できませんでした。',
    };
  }
  revalidatePath('/reports');
  return { error: null };
}
