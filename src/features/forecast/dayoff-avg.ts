import { isDayOff } from '@/domain/forecast/holidays';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { addDays, type DateOnly } from '@/lib/date';

/**
 * 過去の実績から、休日(土日祝)と平日の1日あたり平均支出を計算する。
 * 振替・特別費は除く。日単位で合計してから平均するので、その日に明細が無くても0円の日として数える。
 */
export function computeDayOffWeekdayAverages(
  transactions: readonly ForecastSourceTransaction[],
  from: DateOnly,
  to: DateOnly,
): { dayOffPerDayYen: number | null; weekdayPerDayYen: number | null } {
  const byDate = new Map<string, number>();
  for (const t of transactions) {
    if (t.occurredOn < from || t.occurredOn > to) continue;
    if (
      t.status !== 'actual' ||
      t.isTransfer ||
      t.mustPay ||
      t.kind === 'special' ||
      t.kind === 'refund'
    )
      continue;
    // 支出は負の数。正の数は収入なので数えない。
    if (t.amountYen >= 0) continue;
    byDate.set(t.occurredOn, (byDate.get(t.occurredOn) ?? 0) + -t.amountYen);
  }

  let dayOffSum = 0;
  let dayOffCount = 0;
  let weekdaySum = 0;
  let weekdayCount = 0;

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const yen = byDate.get(d) ?? 0;
    if (isDayOff(d)) {
      dayOffSum += yen;
      dayOffCount += 1;
    } else {
      weekdaySum += yen;
      weekdayCount += 1;
    }
  }

  return {
    dayOffPerDayYen: dayOffCount > 0 ? Math.round(dayOffSum / dayOffCount) : null,
    weekdayPerDayYen: weekdayCount > 0 ? Math.round(weekdaySum / weekdayCount) : null,
  };
}
