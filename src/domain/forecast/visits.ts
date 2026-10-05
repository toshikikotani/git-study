/**
 * 規則的に通う店の検出と、残り期間の来店の見込み(R3)。
 *
 * 同じ店に、ほぼ決まった間隔(週1回の買い出しなど)で通っているなら、その支出は
 * 「毎日ランダムに起きる変動費」ではなく「次はこの日ごろに来る」と予測できる。
 * 日ごとの発生確率で均してしまうより、日付と確率で別に扱うほうが、着地の幅が
 * 現実に近くなる。毎日通う店(間隔1日)や、回数が少ない店は対象にしない。
 */

import { addDays, daysBetween, type DateOnly } from '@/lib/date';
import type { RegularMerchant, VisitEvent } from './types';

/** 規則的とみなす最小の来店回数(日付単位)。 */
const MIN_VISITS = 5;
/** 来店の間隔の下限・上限(日)。毎日通う店は含めない。 */
const MIN_EVERY_DAYS = 2;
const MAX_EVERY_DAYS = 40;
/** 間隔のばらつき(中央値からの中央絶対偏差 ÷ 中央値)の上限。 */
const MAX_RELATIVE_SPREAD = 0.25;
/** 来店の確率の上限と下限。 */
const MAX_PROBABILITY = 0.92;
const MIN_PROBABILITY = 0.5;

export type VisitSourceTransaction = {
  /** 店の識別(正規化済み)。 */
  key: string;
  label: string;
  categoryId: string;
  categoryName: string;
  occurredOn: DateOnly;
  /** 正の数(円)。 */
  amountYen: number;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mostCommon<T>(values: readonly T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export function detectRegularMerchants(
  transactions: readonly VisitSourceTransaction[],
): RegularMerchant[] {
  const groups = new Map<string, VisitSourceTransaction[]>();
  for (const t of transactions) {
    const list = groups.get(t.key) ?? [];
    list.push(t);
    groups.set(t.key, list);
  }

  const out: RegularMerchant[] = [];
  for (const [key, txs] of groups) {
    // 同じ日の複数の明細は1回の来店にまとめる。
    const byDate = new Map<DateOnly, number>();
    for (const t of txs) byDate.set(t.occurredOn, (byDate.get(t.occurredOn) ?? 0) + t.amountYen);
    const dates = [...byDate.keys()].sort();
    if (dates.length < MIN_VISITS) continue;

    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    const everyDays = Math.round(median(gaps));
    if (everyDays < MIN_EVERY_DAYS || everyDays > MAX_EVERY_DAYS) continue;
    const spread = median(gaps.map((g) => Math.abs(g - everyDays))) / everyDays;
    if (spread > MAX_RELATIVE_SPREAD) continue;

    const amounts = dates.map((d) => byDate.get(d)!);
    const meanYen = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const logs = amounts.map((a) => Math.log(Math.max(1, a)));
    const logMu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const logSigma = Math.max(
      0.1,
      Math.sqrt(logs.reduce((a, l) => a + (l - logMu) ** 2, 0) / Math.max(1, logs.length - 1)),
    );
    const probability = Math.min(
      MAX_PROBABILITY,
      Math.max(MIN_PROBABILITY, MAX_PROBABILITY - 1.2 * spread),
    );

    out.push({
      key,
      label: txs[txs.length - 1]!.label,
      categoryId: mostCommon(txs.map((t) => t.categoryId)),
      categoryName: mostCommon(txs.map((t) => t.categoryName)),
      everyDays,
      visitCount: dates.length,
      lastVisit: dates[dates.length - 1]!,
      meanYen,
      logMu,
      logSigma,
      probability,
    });
  }
  return out;
}

/**
 * 残り期間(today の翌日〜periodTo)の来店の見込み。
 * 次回は「最後の来店 + 間隔」。すでに過ぎていて間隔の半分以内なら明日に置き、
 * それ以上過ぎていれば周期が崩れたとみなして、間隔の倍数ぶん先へ送る。
 * 日付入りの予定(scheduledKeys に同じ店の予定がある日の前後1日)と重なる来店は数えない。
 */
export function projectVisits(input: {
  merchants: readonly RegularMerchant[];
  today: DateOnly;
  periodTo: DateOnly;
  scheduled: readonly { key: string; date: DateOnly }[];
}): VisitEvent[] {
  const events: VisitEvent[] = [];
  const tomorrow = addDays(input.today, 1);
  for (const m of input.merchants) {
    let next = addDays(m.lastVisit, m.everyDays);
    if (next <= input.today) {
      const overdue = daysBetween(next, input.today);
      next =
        overdue <= m.everyDays / 2
          ? tomorrow
          : addDays(next, Math.ceil(overdue / m.everyDays) * m.everyDays);
    }
    for (let guard = 0; guard < 60 && next <= input.periodTo; guard += 1) {
      const covered = input.scheduled.some(
        (s) => s.key === m.key && Math.abs(daysBetween(s.date, next)) <= 1,
      );
      if (!covered && next > input.today) {
        events.push({
          key: m.key,
          label: m.label,
          categoryId: m.categoryId,
          date: next,
          probability: m.probability,
          logMu: m.logMu,
          logSigma: m.logSigma,
        });
      }
      next = addDays(next, m.everyDays);
    }
  }
  return events;
}
