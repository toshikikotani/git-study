/**
 * 日付の扱いを1箇所に閉じ込める(ADR-015)。
 *
 * Vercel は UTC、本人の端末は JST。素の Date を使うと深夜の取引が前日に計上され、
 * 金額と日付がずれる。この種の不具合は発見が遅い。
 *
 * 規約:
 *   - 「今日」「今月」は必ず JST で判定する
 *   - 日付は 'YYYY-MM-DD' 文字列(DateOnly)で持ち回る。DB の date 列と同じ形
 *   - new Date() を domain/ や features/ で直接呼ばない。ここを経由する
 */

export const TIMEZONE = 'Asia/Tokyo';

/** 'YYYY-MM-DD'。DB の date 列と1対1で対応する。 */
export type DateOnly = string;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const jstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function assertDateOnly(value: string): DateOnly {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`日付は YYYY-MM-DD 形式である必要があります: ${value}`);
  }
  return value;
}

/** JST における今日。引数で基準時刻を渡せるようにして、テストを決定的にする。 */
export function todayJst(now: Date = new Date()): DateOnly {
  // en-CA ロケールは YYYY-MM-DD を返す
  return jstFormatter.format(now);
}

/** JST における当月の初日。offsetMonths で前後の月を取る。 */
export function monthStartJst(offsetMonths = 0, now: Date = new Date()): DateOnly {
  const [year, month] = splitDateOnly(todayJst(now));
  return addMonthsToParts(year, month, 1, offsetMonths);
}

/** 'YYYY-MM-DD' を [年, 月, 日] に分解する。 */
export function splitDateOnly(date: DateOnly): [number, number, number] {
  assertDateOnly(date);
  const [y, m, d] = date.split('-');
  return [Number(y), Number(m), Number(d)];
}

/**
 * 月を加算する。日付は指定した day に固定する。
 * 月末差異(31日 → 2月)を避けたい呼び出し側は day に 28 以下を渡す。
 */
export function addMonthsToParts(
  year: number,
  month: number,
  day: number,
  offsetMonths: number,
): DateOnly {
  const zeroBased = year * 12 + (month - 1) + offsetMonths;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  const daysInMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const safeDay = Math.min(day, daysInMonth);
  return `${pad(newYear, 4)}-${pad(newMonth, 2)}-${pad(safeDay, 2)}`;
}

/** DateOnly に月を足す。 */
export function addMonths(date: DateOnly, offsetMonths: number): DateOnly {
  const [y, m, d] = splitDateOnly(date);
  return addMonthsToParts(y, m, d, offsetMonths);
}

/** DateOnly に日を足す。 */
export function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = splitDateOnly(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(
    shifted.getUTCDate(),
    2,
  )}`;
}

/** from から to までの日数。to が後なら正。 */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  const [fy, fm, fd] = splitDateOnly(from);
  const [ty, tm, td] = splitDateOnly(to);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / msPerDay);
}

/** 表示用。「2026年9月8日」 */
export function formatDateJa(date: DateOnly): string {
  const [y, m, d] = splitDateOnly(date);
  return `${y}年${m}月${d}日`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
