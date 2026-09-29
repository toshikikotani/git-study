/**
 * カテゴリのペース(目安・理想)の計算(純粋関数)。全カテゴリ合計の目安ではなく、
 * そのカテゴリの予算から出す。
 */

import { daysBetween, type DateOnly } from '@/lib/date';
import type { CategoryLine } from './model';

/**
 * 目標期間中の、このカテゴリの1日の目安。
 *   (カテゴリの予算 − カテゴリの予定支出 − 昨日までのカテゴリの実績)÷ 残り日数(今日を含む)
 * 例:予算 5,300円、予定・実績なし、残り8日 → 約663円。
 * 使い切っている・超えているときは 0円(負にしない)。目標が始まる前は期間全体で割る。
 * 目標期間が終わっている・予算が無いときは null。
 */
export function categoryAllowanceYen(input: {
  budgetYen: number | null;
  /** カテゴリの予定の支出(今日より先)。 */
  scheduledYen: number;
  lines: readonly CategoryLine[];
  goalRange: { from: DateOnly; to: DateOnly };
  today: DateOnly;
}): number | null {
  if (input.budgetYen === null) return null;
  const { goalRange, today } = input;
  if (today > goalRange.to) return null;
  const start = today < goalRange.from ? goalRange.from : today;
  const remaining = daysBetween(start, goalRange.to) + 1;
  let actualBeforeToday = 0;
  for (const l of input.lines) {
    if (l.status !== 'actual') continue;
    if (l.occurredOn < goalRange.from || l.occurredOn >= today) continue;
    actualBeforeToday += -l.amountYen;
  }
  const left = input.budgetYen - input.scheduledYen - actualBeforeToday;
  return Math.max(0, Math.round(left / remaining));
}

/** 表示中の期間(from〜to)が目標期間と重なるか。 */
export function goalOverlaps(
  goalRange: { from: DateOnly; to: DateOnly },
  from: DateOnly,
  to: DateOnly,
): boolean {
  return goalRange.from <= to && goalRange.to >= from;
}
