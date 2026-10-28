import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { addDays, daysBetween, weekdayOf } from '@/lib/date';

export type HabitRow = { name: string; days: number[] };

export type WeekdayHabitData = {
  /** カテゴリ × 曜日(0=日)。多いカテゴリから6つ。 */
  rows: HabitRow[];
  /** 曜日ごとの合計(すべてのカテゴリ。表に出さない7つめ以降のカテゴリも入る)。 */
  totals: number[];
  /** 範囲の中の、その曜日の日数(記録のない日も数える)。1日平均の分母。 */
  dayCounts: number[];
};

/** 出すカテゴリの数(多い順)。 */
const MAX_GENRES = 6;

/**
 * 範囲の支出を、カテゴリ × 曜日(0=日)に足し上げる。予定・振替・対象外・入力待ちは除く。
 * 曜日ごとの合計と、範囲の中のその曜日の日数も返す(本人「曜日ごとに合計と平均を知りたい」、ADR-137)。
 */
export function weekdayHabit(
  transactions: readonly LedgerTransaction[],
  range: { from: string; to: string },
): WeekdayHabitData {
  const byGenre = new Map<string, number[]>();
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const t of transactions) {
    if (t.occurredOn < range.from || t.occurredOn > range.to) continue;
    if (t.amountYen >= 0 || t.isTransfer || t.reviewStatus === 'ignored' || t.needsInput) continue;
    if (t.status === 'scheduled') continue;
    const name = t.genreName ?? '未分類';
    const day = weekdayOf(t.occurredOn);
    const days = byGenre.get(name) ?? [0, 0, 0, 0, 0, 0, 0];
    days[day]! += -t.amountYen;
    totals[day]! += -t.amountYen;
    byGenre.set(name, days);
  }
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  const length = daysBetween(range.from, range.to) + 1;
  for (let i = 0; i < length; i += 1) dayCounts[weekdayOf(addDays(range.from, i))]! += 1;

  const rows = [...byGenre.entries()]
    .map(([name, days]) => ({ name, days, total: days.reduce((a, b) => a + b, 0) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_GENRES)
    .map(({ name, days }) => ({ name, days }));
  return { rows, totals, dayCounts };
}

/** その曜日の1日平均(円、四捨五入)。範囲にその曜日が無ければ null。 */
export function weekdayAverage(data: WeekdayHabitData, day: number): number | null {
  const count = data.dayCounts[day] ?? 0;
  return count > 0 ? Math.round((data.totals[day] ?? 0) / count) : null;
}
