'use server';

import { revalidatePath } from 'next/cache';

import { subscriptionKeyOf } from '@/domain/subscriptions';
import { setGenreForecastClosed } from '@/features/genre/store';
import {
  confirmFixedCost,
  FixedCostStoreError,
  unconfirmFixedCost,
} from '@/features/subscriptions/fixed-cost-store';
import { createClient } from '@/lib/supabase/server';

export async function confirmFixedCostAction(
  subscriptionKey: string,
): Promise<{ error: string | null }> {
  try {
    await confirmFixedCost(subscriptionKey);
    const supabase = await createClient();
    const { data } = await supabase
      .from('transactions')
      .select('genre_id, merchant_name, description, amount_yen')
      .lt('amount_yen', 0);
    const genreIds = new Set(
      (data ?? [])
        .filter(
          (row) =>
            row.genre_id &&
            subscriptionKeyOf(row.merchant_name, row.description, row.amount_yen) ===
              subscriptionKey,
        )
        .map((row) => row.genre_id as string),
    );
    for (const genreId of genreIds) await setGenreForecastClosed(genreId, true);
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
