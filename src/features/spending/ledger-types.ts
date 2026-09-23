/**
 * 家計簿(/spending)の画面向け型だけを持つ(DB にもネットワークにも触れない)。
 *
 * `store.ts` は `next/headers` に依存する `createClient()` を使うため、そこから
 * 型だけを import してもクライアントバンドルへ `next/headers` が引き込まれて
 * しまう(T-7・P10-4 で発見した同種の問題)。明細一覧はソート順の切り替えが
 * 要る(本人発案)ため Client Component にする必要があり、ここの型だけを見る。
 */

import type { BudgetTone } from '@/domain/budget';
import type { PaymentMethod } from '@/features/import/adapters';

export type LedgerTransaction = {
  id: string;
  occurredOn: string;
  /** 店名(無ければ摘要)。 */
  label: string;
  /** カテゴリ統廃合(merged_into_id)を解決済みのルートID(ADR-016)。 */
  categoryId: string | null;
  categoryName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  /** カテゴリ別内訳からレシートの再登録ができるように持ち回る(ADR-038)。 */
  accountId: string;
  paymentMethod: PaymentMethod;
};

export type CategoryBreakdownRow = {
  categoryId: string | null;
  /** null は未分類(categoryId が無い明細)。 */
  categoryName: string;
  /** 使った額(正の数)。 */
  spentYen: number;
  /** 当月の予算。未設定なら null。 */
  budgetYen: number | null;
  /** domain/budget.ts の budgetTone() で判定済み(サーバー側で計算し、ここでは持ち回るだけ)。 */
  tone: BudgetTone;
};

export type MonthlyForecast = {
  elapsedDays: number;
  totalDaysInMonth: number;
  /** このペースが続いた場合の月末着地見込み(正の数)。 */
  projectedTotalYen: number;
  /** カテゴリ予算の合計。1件も設定が無ければ null(比較対象がない)。 */
  totalBudgetYen: number | null;
};

export type MonthlyPace = {
  dayOfMonth: number;
  thisMonthToDateYen: number;
  lastMonthSameDayYen: number;
  /** 正なら今月の方が多い。 */
  differenceYen: number;
};

export type MonthlyLedgerView = {
  period: { from: string; to: string };
  totalSpentYen: number;
  totalIncomeYen: number;
  categoryBreakdown: readonly CategoryBreakdownRow[];
  transactions: readonly LedgerTransaction[];
  forecast: MonthlyForecast;
  pace: MonthlyPace;
};
