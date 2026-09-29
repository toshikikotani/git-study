/**
 * 目標の期間の重なりと、「今の目標」の選び方。
 * 目標は予約できる(進行中の目標の終了日の翌日から次の目標を作れる)ので、複数の
 * 目標が並ぶ。期間が重なる目標は作れない。
 */

import { addDays, formatDateJa, type DateOnly } from '@/lib/date';

export type PlanRange = { id: string; periodStart: DateOnly; periodEnd: DateOnly };

/** 開始日・終了日を含む2つの期間が重なるか。 */
export function periodsOverlap(
  a: { start: DateOnly; end: DateOnly },
  b: { start: DateOnly; end: DateOnly },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** 新しい期間と重なる既存の目標(なければ null)。 */
export function findOverlap<T extends PlanRange>(
  existing: readonly T[],
  range: { start: DateOnly; end: DateOnly },
  ignoreId?: string,
): T | null {
  return (
    existing.find(
      (p) => p.id !== ignoreId && periodsOverlap({ start: p.periodStart, end: p.periodEnd }, range),
    ) ?? null
  );
}

/** 重なりの理由(画面に出す文言)。 */
export function overlapMessage(conflict: PlanRange): string {
  return `${formatDateJa(conflict.periodStart)}〜${formatDateJa(conflict.periodEnd)}の目標と期間が重なっています。重ならない期間を選んでください。`;
}

/**
 * 今の目標を選ぶ:今日を含む目標 → なければ、終わった目標のうち最も新しいもの(振り返り用)
 * → なければ、いちばん近い予約。
 */
export function pickCurrentPlan<T extends PlanRange>(
  plans: readonly T[],
  today: DateOnly,
): T | null {
  const active = plans.find((p) => p.periodStart <= today && today <= p.periodEnd);
  if (active) return active;
  const ended = plans
    .filter((p) => p.periodEnd < today)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  if (ended) return ended;
  return [...plans].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0] ?? null;
}

/** 進行中の目標の次の目標(予約)の開始日の初期値 = 終了日の翌日。 */
export function reservationStart(currentEnd: DateOnly): DateOnly {
  return addDays(currentEnd, 1);
}
