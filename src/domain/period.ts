/**
 * 期間の日数計算を1か所に集める(「残り8日」と「残り7日」が画面ごとに
 * 食い違っていた不具合の対策)。
 *
 * 数え方の約束:**今日を含める**。今日はまだ使える日なので、期末が明日なら
 * 「残り2日」(今日と明日)。「今日使える額」= 残額 ÷ 残り日数 とも噛み合う。
 * 経過日数も今日を含める(期間の初日が今日なら経過1日)。
 *
 * 画面はここを経由せず daysBetween() で残り日数を自前計算しない。
 */

import { addDays, daysBetween, type DateOnly } from '@/lib/date';

/** 期間の日数(開始日・終了日を含む)。 */
export function periodDays(start: DateOnly, end: DateOnly): number {
  return daysBetween(start, end) + 1;
}

/** 経過日数。今日を含む。開始前は 0、終了後は期間の日数で頭打ち。 */
export function elapsedDays(start: DateOnly, end: DateOnly, today: DateOnly): number {
  if (today < start) return 0;
  if (today > end) return periodDays(start, end);
  return daysBetween(start, today) + 1;
}

/** 残り日数。今日を含む(期末が今日なら 1)。開始前は期間の日数、終了後は 0。 */
export function remainingDays(start: DateOnly, end: DateOnly, today: DateOnly): number {
  if (today < start) return periodDays(start, end);
  if (today > end) return 0;
  return daysBetween(today, end) + 1;
}

/** 画面に出す「残りN日」の文言(全画面で同じ表記)。終了後・開始前も含めて1か所で決める。 */
export function formatRemainingDays(start: DateOnly, end: DateOnly, today: DateOnly): string {
  if (today < start) return `${daysBetween(today, start)}日後に開始`;
  if (today > end) return '終了';
  return `残り${remainingDays(start, end, today)}日`;
}

/** 期間の日付を先頭から並べる(カレンダーの帯・ヒートマップ用)。 */
export function eachDay(start: DateOnly, end: DateOnly): DateOnly[] {
  const days: DateOnly[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}
