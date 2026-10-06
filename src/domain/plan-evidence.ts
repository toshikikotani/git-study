/**
 * AI の目標提案の「根拠」(記録日数・対象期間・中央値)と「暫定」の判定。
 * 提案は家計簿の実績から作るので、何日分の記録をもとにしたかを見せる。
 */

import { addDays, type DateOnly } from '@/lib/date';

/** 記録がこの日数に満たない提案は「暫定」。 */
export const PROVISIONAL_UNDER_DAYS = 14;

export type PlanEvidence = {
  /** 記録のある日の数。 */
  recordedDays: number;
  /** 対象期間(最初の記録の日 〜 今日)。記録が無ければ null。 */
  from: DateOnly | null;
  to: DateOnly;
  /** 全ジャンルの1日あたりの支出の中央値。 */
  medianDailyYen: number;
  provisional: boolean;
};

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** from〜to の日別の支出(記録の無い日は0円で埋める)。中央値の母集団。 */
export function dailySeries(
  byDay: ReadonlyMap<DateOnly, number>,
  from: DateOnly,
  to: DateOnly,
): number[] {
  const series: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) series.push(byDay.get(d) ?? 0);
  return series;
}

export function buildPlanEvidence(input: {
  /** 記録のある日(取引のある日)。 */
  recordedDates: readonly DateOnly[];
  /** 日別の支出の合計(実績)。 */
  totalByDay: ReadonlyMap<DateOnly, number>;
  today: DateOnly;
}): PlanEvidence {
  const dates = [...new Set(input.recordedDates)].sort();
  const from = dates[0] ?? null;
  return {
    recordedDays: dates.length,
    from,
    to: input.today,
    medianDailyYen: from === null ? 0 : medianOf(dailySeries(input.totalByDay, from, input.today)),
    provisional: dates.length < PROVISIONAL_UNDER_DAYS,
  };
}
