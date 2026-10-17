'use server';

import { listGenres, type GenreOption } from '@/features/genre/store';
import { listExpenseSubtypesForTransactionIds } from '@/features/receipts/expense-subtype-store';
import {
  listReceiptItemsForTransactionIds,
  type ReceiptItem,
} from '@/features/receipts/items-store';
import { describeUserError } from '@/lib/errors';

/** ホームや予定からも、明細と同じ品目の確認・編集を開く。 */
export async function loadDirectRecordDetailsAction(id: string): Promise<{
  genres: GenreOption[];
  items: ReceiptItem[];
  subtype: string | null;
  error: string | null;
}> {
  try {
    const [genres, items, subtypes] = await Promise.all([
      listGenres(),
      listReceiptItemsForTransactionIds([id]),
      listExpenseSubtypesForTransactionIds([id]),
    ]);
    return { genres, items: items.get(id) ?? [], subtype: subtypes.get(id) ?? null, error: null };
  } catch (error) {
    return {
      genres: [],
      items: [],
      subtype: null,
      error: describeUserError(error, '品目を読み込めませんでした。'),
    };
  }
}
