/**
 * 残りの期間の暦の事情(AIの読みに渡す事実)。統計は過去の同じ月を見るが、連休の並び・
 * 年末年始・お盆などは年ごとにずれるので、残りの日にあるものを数えて渡す。
 */

import { addDays, daysBetween, splitDateOnly, type DateOnly } from '@/lib/date';
import { isDayOff, isHoliday } from './holidays';
import { paydayOn } from './model';

export type CalendarContext = {
  remainingDays: number;
  /** 残りの日のうち、休み(土日祝)の日数と、平日の祝日の日数。 */
  dayOffs: number;
  weekdayHolidays: number;
  /** 残りの日でいちばん長い連休(3日以上のときだけ)。 */
  longestBreak: { from: DateOnly; to: DateOnly; days: number } | null;
  /** 残りの日にある給料日(土日祝なら前の平日)。 */
  payday: DateOnly | null;
  /** 残りの日にかかる、出費が増えやすい時期。 */
  seasons: readonly string[];
};

const SEASONS: readonly { name: string; from: [number, number]; to: [number, number] }[] = [
  { name: '年末年始', from: [12, 28], to: [1, 3] },
  { name: 'ゴールデンウィーク', from: [4, 29], to: [5, 5] },
  { name: 'お盆', from: [8, 13], to: [8, 16] },
  { name: '年度替わり(歓送迎会)', from: [3, 20], to: [4, 10] },
];

function inSeason(date: DateOnly, season: (typeof SEASONS)[number]): boolean {
  const [, m, d] = splitDateOnly(date);
  const key = m * 100 + d;
  const from = season.from[0] * 100 + season.from[1];
  const to = season.to[0] * 100 + season.to[1];
  return from <= to ? key >= from && key <= to : key >= from || key <= to;
}

export function calendarContext(
  today: DateOnly,
  periodTo: DateOnly,
  payday: number | null,
): CalendarContext {
  const dates: DateOnly[] = [];
  for (let d = addDays(today, 1); d <= periodTo; d = addDays(d, 1)) dates.push(d);
  let dayOffs = 0;
  let weekdayHolidays = 0;
  let run: DateOnly[] = [];
  let longest: DateOnly[] = [];
  for (const date of dates) {
    if (isDayOff(date)) {
      dayOffs += 1;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (isHoliday(date) && weekday !== 0 && weekday !== 6) weekdayHolidays += 1;
      run.push(date);
      if (run.length > longest.length) longest = [...run];
    } else {
      run = [];
    }
  }
  let paydayDate: DateOnly | null = null;
  if (payday !== null) {
    for (const date of dates) {
      if (paydayOn(date, payday) === date) {
        paydayDate = date;
        break;
      }
    }
  }
  return {
    remainingDays: dates.length,
    dayOffs,
    weekdayHolidays,
    longestBreak:
      longest.length >= 3
        ? {
            from: longest[0]!,
            to: longest[longest.length - 1]!,
            days: daysBetween(longest[0]!, longest[longest.length - 1]!) + 1,
          }
        : null,
    payday: paydayDate,
    seasons: SEASONS.filter((s) => dates.some((d) => inSeason(d, s))).map((s) => s.name),
  };
}
