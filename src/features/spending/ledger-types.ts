/**
 * 家計簿(/spending)の画面向け型だけを持つ(DB にもネットワークにも触れない)。
 *
 * `store.ts` は `next/headers` に依存する `createClient()` を使うため、そこから
 * 型だけを import してもクライアントバンドルへ `next/headers` が引き込まれて
 * しまう(T-7・P10-4 で発見した同種の問題)。明細一覧はソート順の切り替えが
 * 要る(本人発案)ため Client Component にする必要があり、ここの型だけを見る。
 */

import type { BudgetTone } from '@/domain/budget';
import type { EntryKind, EntryStatus } from '@/domain/ledger';
import type { PaymentMethod } from '@/features/import/adapters';

export type LedgerTransaction = {
  id: string;
  occurredOn: string;
  /** 店名(無ければ摘要)。 */
  label: string;
  genreId: string | null;
  genreName: string | null;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  /** ジャンル別内訳からレシートの再登録ができるように持ち回る(ADR-040)。 */
  accountId: string;
  paymentMethod: PaymentMethod;
  /** 「絶対払わざるを得ないもの」のラベル(ジャンルとは独立した軸)。 */
  mustPay: boolean;
  /** 振替・対象外の判定に使う(集計は domain/ledger.ts が行う)。 */
  isTransfer: boolean;
  reviewStatus: 'auto_ok' | 'pending' | 'confirmed' | 'corrected' | 'ignored';
  /** 日付から導いた実効の状態。今日より未来は 'scheduled'(予定)。 */
  status: EntryStatus;
  /** 特別費('special')は目標のペース計算から除く。 */
  kind: EntryKind;
  /**
   * 分割(レシートの品目・ジャンル按分)の子。空なら分割なし。子のジャンルが
   * 未設定のものは親のジャンルを引き継いだ値が入る(「未分類」の子を作らない)。
   */
  splits: readonly LedgerSplit[];
};

export type LedgerSplit = {
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
};

/**
 * 1か月の合計(正の数)。すべて domain/ledger.ts の summarizeLedger() の値で、
 * 予定(未来日)は spentYen に含めず scheduledYen に分ける。
 */
export type MonthTotals = {
  spentYen: number;
  incomeYen: number;
  /** うち特別費(目標のペース計算から除く)。 */
  specialYen: number;
  /** 未来日の予定の支出。 */
  scheduledYen: number;
  /** 日別の使った額(実績のみ)。カレンダーのヒートマップに使う。 */
  daySpend: Readonly<Record<string, number>>;
  /** 日別の予定の支出。 */
  scheduledDaySpend: Readonly<Record<string, number>>;
};

export type GenreBreakdownRow = {
  genreId: string | null;
  /** null は未分類(genreId が無い明細)。 */
  genreName: string;
  /** 使った額(正の数)。 */
  spentYen: number;
  /** 当月の予算(ジャンルの genres.budget_yen)。未設定なら null。 */
  budgetYen: number | null;
  /** domain/budget.ts の budgetTone() で判定済み(サーバー側で計算し、ここでは持ち回るだけ)。 */
  tone: BudgetTone;
};

export type MonthlyForecast = {
  elapsedDays: number;
  totalDaysInMonth: number;
  /** このペースが続いた場合の月末着地見込み(正の数)。 */
  projectedTotalYen: number;
  /** ジャンル予算の合計。1件も設定が無ければ null(比較対象がない)。 */
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
  totals: MonthTotals;
  totalSpentYen: number;
  totalIncomeYen: number;
  genreBreakdown: readonly GenreBreakdownRow[];
  transactions: readonly LedgerTransaction[];
  forecast: MonthlyForecast;
  pace: MonthlyPace;
};
