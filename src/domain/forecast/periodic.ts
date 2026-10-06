/**
 * 期ごと・年ごとの支払い(設計書 v3 4.4)。住民税(普通徴収)・固定資産税・自動車税・保険の年払い・
 * 2か月ごとの水道など、間隔が 2・3・6・12 か月(55〜65、85〜95、175〜190、350〜380日)の支払いを
 * 見つけ、残りの期間に来るものを確率つきの予定として置く。
 *
 * 同じ店・同じジャンルで、金額がほぼ同じ(±30%以内)支払いの組を、間隔の帯ごとに数える。
 * 組で説明できる支払いがいちばん多い帯(同じなら組の多い帯)を、その支払いの周期とする
 * (2か月ごとの支払いは、たまたま12か月の組もできるが、2か月の組の方が多い)。1年ごとは1組(去年の同じころ)でよく、ほかは2組以上を求める。
 * 住民税のように1年に4回ある支払いも、それぞれの回が「去年の同じ回」と組になる。
 */

import { addDays, daysBetween, type DateOnly } from '@/lib/date';
import type { ProbableEvent } from './types';
import type { VisitSourceTransaction } from './visits';

export type PeriodicPayment = {
  key: string;
  label: string;
  categoryId: string;
  categoryName: string;
  /** 周期の目安(日)と呼び名。 */
  periodDays: number;
  periodLabel: string;
  /** 次の回を予測する元になる、過去の支払いの日付(新しい順に、周期ごとに1つ)。 */
  anchors: readonly DateOnly[];
  /** 組の間隔の中央値(日)。次の回 = 元の日 + これ。 */
  gapDays: number;
  /** 組になった支払いの日付(変動費の学習から外す)。 */
  matchedDates: readonly DateOnly[];
  meanYen: number;
  logMu: number;
  logSigma: number;
  probability: number;
};

const BANDS = [
  { min: 55, max: 65, days: 61, label: '2か月ごと', minPairs: 2 },
  { min: 85, max: 95, days: 91, label: '3か月ごと', minPairs: 2 },
  { min: 175, max: 190, days: 182, label: '半年ごと', minPairs: 2 },
  { min: 350, max: 380, days: 365, label: '1年ごと', minPairs: 1 },
] as const;
/** これより小さい支払いは、期ごとの支払いとして探さない(偶然の一致を減らす)。 */
const MIN_AMOUNT_YEN = 3000;
const MAX_AMOUNT_RATIO = 1.43;
/** 1年あたりの回数の上限(週1の買い物など、回数の多い店を期ごとの支払いとみなさない)。 */
const MAX_PER_YEAR = 6.5;
/** 組になった支払いが、その店の支払いの何割以上か。 */
const MIN_MATCHED_SHARE = 0.6;
/** 予定日を過ぎてもこの日数以内なら、明日に置く(帯の半分ほど)。 */
const OVERDUE_GRACE_DAYS = 10;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function detectPeriodicPayments(
  transactions: readonly VisitSourceTransaction[],
  today: DateOnly,
): PeriodicPayment[] {
  const groups = new Map<string, VisitSourceTransaction[]>();
  for (const t of transactions) {
    if (t.amountYen < MIN_AMOUNT_YEN) continue;
    const key = `${t.key}|${t.categoryId}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: PeriodicPayment[] = [];
  for (const [key, txs] of groups) {
    const byDate = new Map<DateOnly, number>();
    for (const t of txs) byDate.set(t.occurredOn, (byDate.get(t.occurredOn) ?? 0) + t.amountYen);
    const dates = [...byDate.keys()].sort();
    if (dates.length < 2) continue;
    const spanDays = Math.max(365, daysBetween(dates[0]!, today));
    if ((dates.length / spanDays) * 365 > MAX_PER_YEAR) continue;
    let best: { band: (typeof BANDS)[number]; pairs: [DateOnly, DateOnly][] } | null = null;
    for (const band of BANDS) {
      const pairs: [DateOnly, DateOnly][] = [];
      for (let i = 0; i < dates.length; i += 1) {
        for (let j = i + 1; j < dates.length; j += 1) {
          const gap = daysBetween(dates[i]!, dates[j]!);
          if (gap > band.max) break;
          if (gap < band.min) continue;
          const a = byDate.get(dates[i]!)!;
          const b = byDate.get(dates[j]!)!;
          if (Math.max(a, b) / Math.min(a, b) <= MAX_AMOUNT_RATIO)
            pairs.push([dates[i]!, dates[j]!]);
        }
      }
      if (pairs.length < band.minPairs) continue;
      // 説明できる支払いの数(組になった日付)がいちばん多い帯。同じなら組の数が多い帯。
      const covered = new Set(pairs.flat()).size;
      const bestCovered = best ? new Set(best.pairs.flat()).size : -1;
      if (
        best === null ||
        covered > bestCovered ||
        (covered === bestCovered && pairs.length > best.pairs.length)
      ) {
        best = { band, pairs };
      }
    }
    if (best === null) continue;
    const matched = [...new Set(best.pairs.flat())].sort();
    if (matched.length < dates.length * MIN_MATCHED_SHARE) continue;
    const amounts = matched.map((d) => byDate.get(d)!);
    const logs = amounts.map((y) => Math.log(y));
    const logMu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const logSd =
      logs.length > 1
        ? Math.sqrt(logs.reduce((a, v) => a + (v - logMu) ** 2, 0) / (logs.length - 1))
        : 0.1;
    out.push({
      key,
      label: txs.at(-1)!.label,
      categoryId: txs[0]!.categoryId,
      categoryName: txs[0]!.categoryName,
      periodDays: best.band.days,
      periodLabel: best.band.label,
      anchors: [...matched].reverse(),
      gapDays: Math.round(median(best.pairs.map(([a, b]) => daysBetween(a, b)))),
      matchedDates: matched,
      meanYen: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      logMu,
      logSigma: Math.max(0.05, logSd),
      probability: best.pairs.length >= 2 ? 0.9 : 0.75,
    });
  }
  return out;
}

/**
 * 残りの期間(today の翌日〜periodTo)に来る回。元の日 + 間隔 が期間に入り、その前後(帯の半分)に
 * もう支払いが無いものだけ。予定日を少し過ぎていて、まだ払っていなければ明日に置く。
 * 同じ店の予定が前後7日にあれば数えない(予定が主役)。
 */
export function projectPeriodic(input: {
  payments: readonly PeriodicPayment[];
  paidDates: (key: string) => readonly DateOnly[];
  today: DateOnly;
  periodFrom: DateOnly;
  periodTo: DateOnly;
  scheduled: readonly { key: string; date: DateOnly }[];
}): ProbableEvent[] {
  const events: ProbableEvent[] = [];
  const tomorrow = addDays(input.today, 1);
  for (const p of input.payments) {
    const merchantKey = p.key.slice(0, p.key.lastIndexOf('|'));
    const half = Math.round(p.periodDays * 0.08) + 3;
    const paid = input.paidDates(p.key);
    const placed: DateOnly[] = [];
    for (const anchor of p.anchors) {
      let date = addDays(anchor, p.gapDays);
      if (date < input.periodFrom || date > input.periodTo) continue;
      const due = date;
      // その回はもう払った(予定日の前後に、同じ店の支払いがある)。
      if (paid.some((d) => d > anchor && Math.abs(daysBetween(d, due)) <= half)) continue;
      if (date <= input.today) {
        if (daysBetween(date, input.today) > OVERDUE_GRACE_DAYS) continue;
        date = tomorrow;
        if (date > input.periodTo) continue;
      }
      const target = date;
      if (placed.some((d) => Math.abs(daysBetween(d, target)) <= half)) continue;
      const covered = input.scheduled.some(
        (s) => s.key === merchantKey && Math.abs(daysBetween(s.date, target)) <= 7,
      );
      if (covered) continue;
      placed.push(target);
      events.push({
        key: p.key,
        label: p.label,
        categoryId: p.categoryId,
        date: target,
        probability: p.probability,
        logMu: p.logMu,
        logSigma: p.logSigma,
        fixedYen: p.logSigma <= 0.05 ? Math.round(Math.exp(p.logMu)) : null,
      });
    }
  }
  return events;
}
