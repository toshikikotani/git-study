/**
 * 日本の祝日(予測モデルの曜日・祝日効果用)。祝日法の規則から計算する(2007年以降の制度)。
 *
 *   - 固定日の祝日、ハッピーマンデー(第n月曜)、春分・秋分(近似式)
 *   - 振替休日:祝日が日曜なら、その後で最初の祝日でない日
 *   - 国民の休日:前後を祝日にはさまれた平日
 *
 * 春分・秋分は1980〜2099年で有効な近似式。天皇誕生日は2020年から2/23(2019年までは別の日で、
 * 予測の学習窓に入らない昔の年なので扱わない)。
 */

import { addDays, splitDateOnly, weekdayOf, type DateOnly } from '@/lib/date';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): DateOnly => `${y}-${pad(m)}-${pad(d)}`;

/** その月の第n月曜日の日付(日)。 */
function nthMonday(year: number, month: number, n: number): number {
  const firstWeekday = weekdayOf(ymd(year, month, 1)); // 0=日
  const firstMonday = 1 + ((8 - firstWeekday) % 7);
  return firstMonday + (n - 1) * 7;
}

function springEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 法律で決まっている祝日(振替休日・国民の休日を除く)。 */
function baseHolidays(year: number): Set<DateOnly> {
  const days = [
    ymd(year, 1, 1),
    ymd(year, 1, nthMonday(year, 1, 2)), // 成人の日
    ymd(year, 2, 11),
    ymd(year, 3, springEquinoxDay(year)),
    ymd(year, 4, 29),
    ymd(year, 5, 3),
    ymd(year, 5, 4),
    ymd(year, 5, 5),
    ymd(year, 7, nthMonday(year, 7, 3)), // 海の日
    ymd(year, 8, 11),
    ymd(year, 9, nthMonday(year, 9, 3)), // 敬老の日
    ymd(year, 9, autumnEquinoxDay(year)),
    ymd(year, 10, nthMonday(year, 10, 2)), // スポーツの日
    ymd(year, 11, 3),
    ymd(year, 11, 23),
  ];
  if (year >= 2020) days.push(ymd(year, 2, 23));
  return new Set(days);
}

const cache = new Map<number, ReadonlySet<DateOnly>>();

function holidaysOfYear(year: number): ReadonlySet<DateOnly> {
  const cached = cache.get(year);
  if (cached) return cached;
  const all = baseHolidays(year);
  // 振替休日:日曜の祝日の次の、祝日でない日。
  for (const day of [...all]) {
    if (weekdayOf(day) !== 0) continue;
    let next = addDays(day, 1);
    while (all.has(next)) next = addDays(next, 1);
    all.add(next);
  }
  // 国民の休日:前日と翌日が祝日の平日(日曜・祝日そのものは除く)。
  const first = ymd(year, 1, 1);
  for (let d = first; splitDateOnly(d)[0] === year; d = addDays(d, 1)) {
    if (all.has(d) || weekdayOf(d) === 0) continue;
    if (all.has(addDays(d, -1)) && all.has(addDays(d, 1))) all.add(d);
  }
  cache.set(year, all);
  return all;
}

/** DateOnly('YYYY-MM-DD') が日本の祝日(振替休日・国民の休日を含む)かどうか。 */
export function isHoliday(date: DateOnly): boolean {
  return holidaysOfYear(splitDateOnly(date)[0]).has(date);
}

/** 休みの日(土日または祝日)。 */
export function isDayOff(date: DateOnly): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6 || isHoliday(date);
}
