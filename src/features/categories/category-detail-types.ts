/**
 * ホームの予算タイル1枠分の内訳の、画面向け型だけを持つ(DB にも
 * ネットワークにも触れない)。
 *
 * `category-detail-store.ts` は `next/headers` に依存する `createClient()` を
 * 使うため、そこから型だけを import してもクライアントバンドルへ
 * `next/headers` が引き込まれてしまう(T-7 で発見した同種の問題:
 * `features/transactions/types.ts` と同じ理由でここも分離してある)。
 * `ExpandableBudgetTile`(Client Component)はこちらの型だけを見る。
 */

import type { BudgetStatus } from '@/domain/budget';

export type CategoryTransactionDetail = {
  id: string;
  occurredOn: string;
  description: string;
  merchantName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
};

export type CategoryMonthDetail = {
  categoryId: string;
  categoryName: string;
  status: BudgetStatus;
  /** 集計対象(isCountable)の当月の明細のみ。日付の新しい順。 */
  transactions: readonly CategoryTransactionDetail[];
};
