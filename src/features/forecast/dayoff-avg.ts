import { isDayOff } from '@/domain/forecast/holidays';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import type { DateOnly } from '@/lib/date';

/**
 * 過去の実績から、休日(土日祝)と平日の1日あたり平均支出を計算する。
 * 振替・特別費・固定費は除く。支出があった日だけで平均を取る（0円の日は数えない）。
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

  const dayOffDays: number[] = [];
  const weekdayDays: number[] = [];

  // 支出があった日だけ。0円の日は数えない。
  for (const [date, yen] of byDate) {
    if (yen <= 0) continue;
    if (isDayOff(date)) dayOffDays.push(yen);
    else weekdayDays.push(yen);
  }

  // 中央値を使う。大きい日に引っ張られない。
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
      : sorted[mid]!;
  };

  return {
    dayOffPerDayYen: median(dayOffDays),
    weekdayPerDayYen: median(weekdayDays),
  };
}
