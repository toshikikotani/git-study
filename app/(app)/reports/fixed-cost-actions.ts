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

/**
 * 記録するの「固定費にする」(ADR-102)。その記録だけを固定費にする(must_pay)。同じ店・同じ額の支払いを
 * 固定費と覚えておく(固定費の確認)が、カテゴリ全体は固定費にしない。以前は confirmFixedCostAction で
 * カテゴリごと固定費(予測を止める)にしていたため、1件の記録のつもりが、そのカテゴリの支出がすべて
 * 「最近の支出の勢い」などから外れていた。
 */
export async function markRecordFixedAction(
  transactionIds: readonly string[],
  subscriptionKey: string,
): Promise<{ error: string | null }> {
  try {
    await confirmFixedCost(subscriptionKey);
    if (transactionIds.length > 0) {
      const supabase = await createClient();
      const { error } = await supabase
        .from('transactions')
        .update({ must_pay: true })
        .in('id', [...transactionIds]);
      if (error) return { error: '固定費にできませんでした。' };
    }
  } catch (error) {
    return {
      error: error instanceof FixedCostStoreError ? error.message : '固定費にできませんでした。',
    };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}
