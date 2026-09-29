/**
 * 期間選択カレンダーのマス割り。期間が月をまたぐときは該当する月を縦に並べ、
 * 期間全体を(週ごとの)連続した帯で見せる。
 */

import { addDays, addMonths, daysBetween, nthDayOfMonth, weekdayOf, type DateOnly } from '@/lib/date';

/** 表示する月(各月の1日)。期間が無ければ今月と翌月。extra で後ろへ足せる。 */
export function monthsToShow(
  start: DateOnly | null,
  end: DateOnly | null,
  today: DateOnly,
  extra = 0,
): DateOnly[] {
  const first = nthDayOfMonth(start ?? today, 1);
  const last = nthDayOfMonth(end ?? addMonths(first, 1), 1);
  const lastShown = last > first ? last : addMonths(first, 1);
  const months: DateOnly[] = [];
  for (let m = first; m <= lastShown; m = addMonths(m, 1)) months.push(m);
  for (let i = 1; i <= extra; i += 1) months.push(addMonths(lastShown, i));
  return months;
}

/** 1か月の週の並び(日曜始まり。月外のマスは null)。 */
export function weekRows(monthStart: DateOnly): (DateOnly | null)[][] {
  const days = daysBetween(monthStart, addMonths(monthStart, 1));
  const cells: (DateOnly | null)[] = [
    ...Array.from({ length: weekdayOf(monthStart) }, () => null),
    ...Array.from({ length: days }, (_, i) => addDays(monthStart, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (DateOnly | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/**
 * 1週の中で、期間 [start, end] に入るマスの範囲(列の番号、両端を含む)。
 * 週をまたいでも、各週の帯がつながって1本の帯に見える。入るマスが無ければ null。
 */
export function bandInWeek(
  week: readonly (DateOnly | null)[],
  start: DateOnly | null,
  end: DateOnly | null,
): { from: number; to: number } | null {
  if (start === null || end === null) return null;
  let from = -1;
  let to = -1;
  week.forEach((d, i) => {
    if (d !== null && d >= start && d <= end) {
      if (from < 0) from = i;
      to = i;
    }
  });
  return from < 0 ? null : { from, to };
}
