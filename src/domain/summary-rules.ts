/**
 * 家計簿のサマリーに何を出すかの判断(表示しないことも含めて1か所で決める)。
 *
 * 記録が少ないときに、意味のない数字(前月のデータが無いのに「先月同日は0円、
 * 31,542円多い」、数日の記録から外挿した月末予測、収入が未登録なのに「差額 −○円」)
 * を出さないための規則。
 *
 *   - 前月比較:先月の同じ日より前から記録があるときだけ。無ければ「記録開始からN日」
 *   - 月末予測:今月の記録日数(取引のある日の数)が7日以上のときだけ
 *   - 収入・差額:収入が登録されていなければ出さず、「収入を登録」への導線にする
 */

import { daysBetween, type DateOnly } from '@/lib/date';

/** 月末予測を出すのに必要な、今月の記録日数(取引のある日の数)。 */
export const FORECAST_MIN_RECORDED_DAYS = 7;

export type PaceComparison =
  | { kind: 'compare'; dayOfMonth: number; lastYen: number; diffYen: number }
  | { kind: 'since_start'; days: number }
  | { kind: 'none' };

export function paceComparison(input: {
  today: DateOnly;
  /** 最初の記録の日。記録が1件も無ければ null。 */
  firstRecordedOn: DateOnly | null;
  /** 先月の同じ日(月末に丸め済み)。 */
  lastMonthSameDay: DateOnly;
  dayOfMonth: number;
  thisMonthToDateYen: number;
  lastMonthSameDayYen: number;
}): PaceComparison {
  if (input.firstRecordedOn === null) return { kind: 'none' };
  // 先月の同じ日にはもう記録を始めていた、というときだけ比べられる。
  if (input.firstRecordedOn <= input.lastMonthSameDay) {
    return {
      kind: 'compare',
      dayOfMonth: input.dayOfMonth,
      lastYen: input.lastMonthSameDayYen,
      diffYen: input.thisMonthToDateYen - input.lastMonthSameDayYen,
    };
  }
  return { kind: 'since_start', days: daysBetween(input.firstRecordedOn, input.today) + 1 };
}

/** 月末予測を出してよいか。 */
export function canShowForecast(recordedDaysThisMonth: number): boolean {
  return recordedDaysThisMonth >= FORECAST_MIN_RECORDED_DAYS;
}

/** 収入が登録されているか(0円は未登録として扱う)。 */
export function hasIncome(incomeYen: number): boolean {
  return incomeYen > 0;
}

/** 今日までの日数(月初〜今日)のうち、取引のある日の数。 */
export function countRecordedDays(dates: Iterable<DateOnly>): number {
  return new Set(dates).size;
}
