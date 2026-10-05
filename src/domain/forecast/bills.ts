/**
 * 月払いの請求(電気・ガス・携帯・習い事の月謝など)。
 *
 * 同じ店・同じジャンルの支払いが、ほぼ1か月おき(26〜35日)に来ているなら、それは毎日ランダムに
 * 起きる変動費ではなく「来月も同じころに来る請求」とみなす。確認済みの固定費(サブスク)と違い、
 * 本人の確認が無いので、確率つきで置く(3回以上そろっていれば 0.95、2回だけなら 0.85)。
 * 金額のばらつきが5%以内なら毎回その額、それより大きければ過去の金額の対数正規から引く。
 */

import { addDays, addMonths, daysBetween, type DateOnly } from '@/lib/date';
import type { MonthlyBill, ProbableEvent } from './types';
import { recencyWeightedAmounts, type VisitSourceTransaction } from './visits';

const MIN_OCCURRENCES = 2;
const MIN_INTERVAL = 26;
const MAX_INTERVAL = 35;
/** 金額の変動係数の上限(これより大きいと、請求ではなく買い物とみなす)。 */
const MAX_AMOUNT_CV = 0.5;
/** 2回だけのときは、金額がよりそろっていることを求める(偶然の一致を請求とみなさない)。 */
const MAX_AMOUNT_CV_TWO = 0.25;
const FIXED_AMOUNT_CV = 0.05;
/** 最後の支払いからこれより空いていたら、請求は止まったとみなす。 */
const MAX_DAYS_SINCE_LAST = 45;
/** 予定日を過ぎてもこの日数以内なら、明日に置く(引き落としの遅れ)。 */
const OVERDUE_GRACE_DAYS = 7;

function stats(values: readonly number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.length > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1) : 0;
  return { mean, sd: Math.sqrt(variance) };
}

export function detectMonthlyBills(
  transactions: readonly VisitSourceTransaction[],
  today: DateOnly,
): (MonthlyBill & { logMu: number; logSigma: number })[] {
  const groups = new Map<string, VisitSourceTransaction[]>();
  for (const t of transactions) {
    const key = `${t.key}|${t.categoryId}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const out: (MonthlyBill & { logMu: number; logSigma: number })[] = [];
  for (const [key, txs] of groups) {
    const byDate = new Map<DateOnly, number>();
    for (const t of txs) byDate.set(t.occurredOn, (byDate.get(t.occurredOn) ?? 0) + t.amountYen);
    const dates = [...byDate.keys()].sort();
    if (dates.length < MIN_OCCURRENCES) continue;
    const intervals = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    if (intervals.some((g) => g < MIN_INTERVAL || g > MAX_INTERVAL)) continue;
    const last = dates[dates.length - 1]!;
    if (daysBetween(last, today) > MAX_DAYS_SINCE_LAST) continue;
    const amounts = dates.map((d) => byDate.get(d)!);
    const { mean, sd } = stats(amounts);
    const cv = mean > 0 ? sd / mean : Infinity;
    if (cv > (dates.length === 2 ? MAX_AMOUNT_CV_TWO : MAX_AMOUNT_CV)) continue;
    const weighted = recencyWeightedAmounts(dates, amounts, 0.05);
    out.push({
      key,
      label: txs[txs.length - 1]!.label,
      categoryId: txs[0]!.categoryId,
      categoryName: txs[0]!.categoryName,
      lastPaid: last,
      occurrences: dates.length,
      meanYen: weighted.meanYen,
      probability: dates.length >= 3 ? 0.95 : 0.85,
      fixedYen: cv <= FIXED_AMOUNT_CV ? Math.round(amounts[amounts.length - 1]!) : null,
      logMu: weighted.logMu,
      logSigma: weighted.logSigma,
    });
  }
  return out;
}

/**
 * 残り期間(today の翌日〜periodTo)の請求。次回は最後の支払いの1か月後。過ぎていても7日以内なら
 * 明日に置き、それより過ぎていればその回は来なかったとみなす。同じ店の予定が前後3日にあれば数えない。
 */
export function projectBills(input: {
  bills: readonly (MonthlyBill & { logMu: number; logSigma: number })[];
  today: DateOnly;
  periodTo: DateOnly;
  scheduled: readonly { key: string; date: DateOnly }[];
}): ProbableEvent[] {
  const events: ProbableEvent[] = [];
  const tomorrow = addDays(input.today, 1);
  for (const bill of input.bills) {
    const merchantKey = bill.key.slice(0, bill.key.lastIndexOf('|'));
    for (let i = 1; i <= 24; i += 1) {
      let date = addMonths(bill.lastPaid, i);
      if (date > input.periodTo) break;
      if (date <= input.today) {
        if (i === 1 && daysBetween(date, input.today) <= OVERDUE_GRACE_DAYS) date = tomorrow;
        else continue;
      }
      const target = date;
      const covered = input.scheduled.some(
        (s) => s.key === merchantKey && Math.abs(daysBetween(s.date, target)) <= 3,
      );
      if (covered) continue;
      events.push({
        key: bill.key,
        label: bill.label,
        categoryId: bill.categoryId,
        date: target,
        probability: bill.probability,
        logMu: bill.logMu,
        logSigma: bill.logSigma,
        fixedYen: bill.fixedYen,
      });
    }
  }
  return events;
}
