/**
 * 規則的に通う店の検出と、残り期間の来店の見込み(R3)。
 *
 * 同じ店に、ほぼ決まった間隔(週1回の買い出しなど)で通っているなら、その支出は
 * 「毎日ランダムに起きる変動費」ではなく「次はこの日ごろに来る」と予測できる。
 * 日ごとの発生確率で均してしまうより、日付と確率で別に扱うほうが、着地の幅が
 * 現実に近くなる。毎日通う店(間隔1日)や、回数が少ない店は対象にしない。
 */

import { addDays, daysBetween, type DateOnly } from '@/lib/date';
import type { ProbableEvent, RegularMerchant } from './types';

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

/** 直近を重く見る半減期(日)。物価や暮らしの変化で、昔の金額ほど今の金額から離れるため。 */
const AMOUNT_HALF_LIFE_DAYS = 90;

/**
 * 金額の対数正規(平均・標準偏差)を、最後の日に近いほど重く(半減期90日)して求める。
 * 来店・請求の金額が、2年前の金額に引っ張られて低く出ないようにする。
 */
export function recencyWeightedAmounts(
  dates: readonly DateOnly[],
  amounts: readonly number[],
  minSigma: number,
): { meanYen: number; logMu: number; logSigma: number } {
  const last = dates[dates.length - 1]!;
  const weights = dates.map((d) => Math.pow(0.5, daysBetween(d, last) / AMOUNT_HALF_LIFE_DAYS));
  const total = weights.reduce((a, b) => a + b, 0);
  const logs = amounts.map((a) => Math.log(Math.max(1, a)));
  const logMu = logs.reduce((acc, l, i) => acc + weights[i]! * l, 0) / total;
  const meanYen = amounts.reduce((acc, a, i) => acc + weights[i]! * a, 0) / total;
  // ばらつきは件数で測る(重みを掛けると、件数が少ないときに小さく出すぎる)。
  const plainMu = logs.reduce((a, b) => a + b, 0) / logs.length;
  const variance = logs.reduce((a, l) => a + (l - plainMu) ** 2, 0) / Math.max(1, logs.length - 1);
  return { meanYen, logMu, logSigma: Math.max(minSigma, Math.sqrt(variance)) };
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
    const { meanYen, logMu, logSigma } = recencyWeightedAmounts(dates, amounts, 0.1);
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
 * 残り期間(today の翌日〜periodTo)の来店の見込み。期間の終わりまで、すべての回を置く。
 * 次回は「最後の来店 + 間隔」。すでに過ぎていれば(間隔1回ぶん以内)、明日に「来る確率を半分」で
 * 置く(来るかもしれないし、周期が崩れたのかもしれない)。それ以降の回は、明日から間隔ごと。
 * 間隔1回ぶんより長く過ぎていれば、周期が崩れたとみなし、過ぎた回は置かない。
 * 日付入りの予定(同じ店の予定がある日の前後1日)と重なる来店は数えない。
 */
export function projectVisits(input: {
  merchants: readonly RegularMerchant[];
  today: DateOnly;
  periodTo: DateOnly;
  scheduled: readonly { key: string; date: DateOnly }[];
}): ProbableEvent[] {
  const events: ProbableEvent[] = [];
  const tomorrow = addDays(input.today, 1);
  for (const m of input.merchants) {
    let next = addDays(m.lastVisit, m.everyDays);
    let probability = m.probability;
    if (next <= input.today) {
      const overdue = daysBetween(next, input.today);
      if (overdue < m.everyDays) {
        next = tomorrow;
        probability = m.probability / 2;
      } else {
        next = addDays(next, Math.ceil((overdue + 1) / m.everyDays) * m.everyDays);
      }
    }
    for (let guard = 0; guard < 400 && next <= input.periodTo; guard += 1) {
      const date = next;
      const covered = input.scheduled.some(
        (s) => s.key === m.key && Math.abs(daysBetween(s.date, date)) <= 1,
      );
      if (!covered && date > input.today) {
        events.push({
          key: m.key,
          label: m.label,
          categoryId: m.categoryId,
          date,
          probability,
          logMu: m.logMu,
          logSigma: m.logSigma,
          fixedYen: null,
        });
      }
      probability = m.probability;
      next = addDays(next, m.everyDays);
    }
  }
  return events;
}
