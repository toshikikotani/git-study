/**
 * 家計簿の各画面が表示する数字を、1回の集計(summarizeLedger)から組み立てる。
 * DB にも画面にも触れない純粋関数。
 *
 * ヘッダー・ジャンル内訳・明細の日別合計・カレンダー・目標のジャンル進捗は
 * すべてここの戻り値を使う。「同じ期間なら全画面の合計が一致する」は
 * tests/features/spending/views.test.ts が保証する。
 */

import { isCountable } from '@/domain/budget';
import {
  entryStatus,
  summarizeLedger,
  type LedgerEntry,
  type LedgerRange,
  type LedgerSummary,
} from '@/domain/ledger';
import type { DateOnly } from '@/lib/date';
import { breakdownFromSummary } from './breakdown';
import type { GenreBreakdownRow, LedgerTransaction, MonthTotals } from './ledger-types';

/** 明細(親)を集計の入力(分割の子へ展開済み)にする。全画面が同じ展開を使う。 */
export function toLedgerEntries(transactions: readonly LedgerTransaction[]): LedgerEntry[] {
  return transactions.flatMap((t): LedgerEntry[] => {
    const base = {
      id: t.id,
      occurredOn: t.occurredOn,
      isTransfer: t.isTransfer,
      reviewStatus: t.reviewStatus,
      kind: t.kind,
    };
    if (t.splits.length === 0) {
      return [{ ...base, categoryId: t.genreId, amountYen: t.amountYen }];
    }
    return t.splits.map((s) => ({ ...base, categoryId: s.genreId, amountYen: s.amountYen }));
  });
}

export function totalsOf(summary: LedgerSummary): MonthTotals {
  return {
    spentYen: summary.spentYen,
    incomeYen: summary.incomeYen,
    specialYen: summary.specialYen,
    scheduledYen: summary.scheduledYen,
    daySpend: Object.fromEntries(summary.byDay),
    scheduledDaySpend: Object.fromEntries(summary.scheduledByDay),
  };
}

export type DayGroup = {
  date: DateOnly;
  /** その日の使った額(実績のみ、正の数)。 */
  spentYen: number;
  transactions: LedgerTransaction[];
};

export type LedgerViews = {
  summary: LedgerSummary;
  totals: MonthTotals;
  genreBreakdown: GenreBreakdownRow[];
  /** 集計対象の実績の明細を日付ごとに。新しい日付が先頭。 */
  dayGroups: DayGroup[];
  /** 予定(未来日)の明細。近い日付が先頭。 */
  scheduled: LedgerTransaction[];
};

/** 期間 range の各画面向けの表示データ。 */
export function buildLedgerViews(input: {
  genres: readonly { id: string; name: string; budget_yen: number | null }[];
  transactions: readonly LedgerTransaction[];
  range: LedgerRange;
  today: DateOnly;
}): LedgerViews {
  const { genres, range, today } = input;
  const inRange = input.transactions.filter(
    (t) => t.occurredOn >= range.from && t.occurredOn <= range.to && isCountable(asBudgetTx(t)),
  );
  const summary = summarizeLedger(toLedgerEntries(inRange), range, today);

  const byDate = new Map<DateOnly, LedgerTransaction[]>();
  const scheduled: LedgerTransaction[] = [];
  for (const t of inRange) {
    if (entryStatus(t.occurredOn, today) === 'scheduled') {
      scheduled.push(t);
      continue;
    }
    const list = byDate.get(t.occurredOn) ?? [];
    list.push(t);
    byDate.set(t.occurredOn, list);
  }

  const dayGroups = [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, transactions]) => ({
      date,
      spentYen: summary.byDay.get(date) ?? 0,
      transactions,
    }));

  return {
    summary,
    totals: totalsOf(summary),
    genreBreakdown: breakdownFromSummary(genres, summary),
    dayGroups,
    scheduled: scheduled.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn)),
  };
}

function asBudgetTx(t: LedgerTransaction) {
  return {
    categoryId: t.genreId,
    amountYen: t.amountYen,
    isTransfer: t.isTransfer,
    reviewStatus: t.reviewStatus,
  };
}
