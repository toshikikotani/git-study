'use server';

import { revalidatePath } from 'next/cache';

import { saveReceiptItemFix } from '@/features/receipts/receipt-check-store';
import { describeUserError } from '@/lib/errors';

/** AI でチェックで選んだ直し方で、レシートの品目を置き換える(ADR-120)。 */
export async function saveReceiptItemFixAction(input: unknown): Promise<{ error: string | null }> {
  try {
    await saveReceiptItemFix(input);
  } catch (error) {
    return {
      error: describeUserError(error, '品目を保存できませんでした。もう一度お試しください。'),
    };
  }
  revalidatePath('/spending');
  return { error: null };
}
