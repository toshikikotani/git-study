'use server';

import { revalidatePath } from 'next/cache';

import {
  listMerchantNameReviewGroups,
  saveMerchantNameChanges,
  type MerchantNameReviewGroup,
  type MerchantNameSaveResult,
} from '@/features/transactions/merchant-name-store';
import { describeUserError } from '@/lib/errors';

/**
 * 店名の表記ゆれ・店名なし・住所のような店名を、いますべての月の明細から探す(本人の要望「任意の
 * タイミングで実行できるように」、ADR-118)。読むだけで、何も書き換えない。
 */
export async function findMerchantNameGroupsAction(): Promise<{
  groups: MerchantNameReviewGroup[];
  error: string | null;
}> {
  try {
    return { groups: await listMerchantNameReviewGroups(), error: null };
  } catch (error) {
    return {
      groups: [],
      error: describeUserError(error, '店名の確認を読み込めませんでした。もう一度お試しください。'),
    };
  }
}

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
