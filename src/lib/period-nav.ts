import { addMonths } from './date';

/** URLの月。配列は先頭を使い、壊れた値では別の期間を読まない。 */
export function validMonthKey(value: string | string[] | null | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(first) ? first : null;
}

/** 月切替と同じ範囲だけを復元する(過去10年〜未来2年)。 */
export function resolveCalendarMonthStart(
  value: string | string[] | null | undefined,
  currentMonthStart: string,
): string {
  const key = validMonthKey(value);
  if (key === null) return currentMonthStart;
  const month = `${key}-01`;
  return month >= addMonths(currentMonthStart, -120) && month <= addMonths(currentMonthStart, 24)
    ? month
    : currentMonthStart;
}

export function monthReviewHref(month: string): string {
  return `/reports/month?month=${month.slice(0, 7)}`;
}

/** 戻り先には同じアプリ内のパスだけを許す。 */
export function safeInternalHref(value: string | null | undefined, fallback: string): string {
  return value && /^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value) ? value : fallback;
}
