import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { weekdayOf } from '@/lib/date';

export type HabitRow = { name: string; days: number[] };

/** 出すカテゴリの数(多い順)。 */
const MAX_GENRES = 6;

/** 範囲の支出を、カテゴリ × 曜日(0=日)に足し上げる。多いカテゴリから6つ。予定・振替・対象外は除く。 */
export function weekdayHabitRows(
  transactions: readonly LedgerTransaction[],
  range: { from: string; to: string },
): HabitRow[] {
  const byGenre = new Map<string, number[]>();
  for (const t of transactions) {
    if (t.occurredOn < range.from || t.occurredOn > range.to) continue;
    if (t.amountYen >= 0 || t.isTransfer || t.reviewStatus === 'ignored' || t.needsInput) continue;
    if (t.status === 'scheduled') continue;
    const name = t.genreName ?? '未分類';
    const days = byGenre.get(name) ?? [0, 0, 0, 0, 0, 0, 0];
    days[weekdayOf(t.occurredOn)]! += -t.amountYen;
    byGenre.set(name, days);
  }
  return [...byGenre.entries()]
    .map(([name, days]) => ({ name, days, total: days.reduce((a, b) => a + b, 0) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_GENRES)
    .map(({ name, days }) => ({ name, days }));
}
