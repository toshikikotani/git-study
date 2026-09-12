/**
 * 請求金額メールとの突合(FR-18, M6-4)。
 *
 * メールから読み取った期間(features/import/statement-email.ts)が
 * 欠けていても、口座の締め日(accounts.closing_day)があれば補える。
 * 突合そのもの(差額の判定)は「金額を比べるだけ」の純粋関数にする。
 */

import { billingCycleStartFor, mostRecentClosingOnOrBefore, type DateOnly } from '@/lib/date';

export type BillingPeriod = {
  startOn: DateOnly;
  endOn: DateOnly;
};

/**
 * 突合に使う期間を決める。
 *
 * メールに期間の記載があればそれを使う。無ければ口座の締め日から
 * 「直近で締まった請求サイクル」を計算する。締め日も無ければ
 * 期間を決められないので null(呼び出し側は本人に締め日の設定か
 * 期間の手入力を促す)。
 */
export function billingPeriodFor(
  parsedPeriod: { periodStartOn: DateOnly | null; periodEndOn: DateOnly | null },
  closingDay: number | null,
  today: DateOnly,
): BillingPeriod | null {
  if (parsedPeriod.periodStartOn !== null && parsedPeriod.periodEndOn !== null) {
    return { startOn: parsedPeriod.periodStartOn, endOn: parsedPeriod.periodEndOn };
  }
  if (closingDay === null) return null;

  const endOn = parsedPeriod.periodEndOn ?? mostRecentClosingOnOrBefore(today, closingDay);
  const startOn = parsedPeriod.periodStartOn ?? billingCycleStartFor(endOn, closingDay);
  return { startOn, endOn };
}

export type ReconciliationOutcome = {
  /** announcedTotalYen - importedTotalYen。正なら取り込み漏れの疑い、負なら取り込みすぎ(振替除外漏れ等)の疑い。 */
  differenceYen: number;
  hasDiscrepancy: boolean;
};

/** メールの合計と、取り込み済み明細の合計を比べる。 */
export function reconcileTotals(
  announcedTotalYen: number,
  importedTotalYen: number,
): ReconciliationOutcome {
  const differenceYen = announcedTotalYen - importedTotalYen;
  return { differenceYen, hasDiscrepancy: differenceYen !== 0 };
}
