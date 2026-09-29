/**
 * カレンダーのヒートマップ用の純粋関数(週・月のマス割り、色の濃さの段階)。
 */

import { addDays, weekdayOf, type DateOnly } from '@/lib/date';
import { monthRange } from '@/domain/ledger';

/** date を含む週(日曜始まり)の7日。 */
export function weekOf(date: DateOnly): DateOnly[] {
  const start = addDays(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 月のマス(日曜始まり、前後の月の日で埋めた週の並び)。 */
export function monthGrid(monthKey: string): DateOnly[][] {
  const { from, to } = monthRange(monthKey);
  const weeks: DateOnly[][] = [];
  let cursor = addDays(from, -weekdayOf(from));
  while (cursor <= to) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/**
 * 金額の大きさを 0〜4 の濃さの段階にする(0 は記録なし)。表示中の最大額を基準に
 * 均等に4分割する。金額の色だけで伝えないよう、画面側で金額の数字も添える。
 */
export function heatLevel(amountYen: number, maxYen: number): 0 | 1 | 2 | 3 | 4 {
  if (amountYen <= 0 || maxYen <= 0) return 0;
  const ratio = amountYen / maxYen;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}
