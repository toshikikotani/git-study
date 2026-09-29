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

export type DayGroup<T extends LedgerTransaction = LedgerTransaction> = {
  date: DateOnly;
  /** その日の使った額(実績のみ、正の数)。 */
  spentYen: number;
  transactions: T[];
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

  const { dayGroups, scheduled } = groupForList(inRange, summary.byDay, today);

  return {
    summary,
    totals: totalsOf(summary),
    genreBreakdown: breakdownFromSummary(genres, summary),
    dayGroups,
    scheduled,
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

/**
 * 明細を、実績の日付ごとのグループ(新しい日付が先頭)と、予定(未来日)に分ける。
 * 日別の合計は集計関数の値(byDay)をそのまま使う。
 */
export function groupForList<T extends LedgerTransaction>(
  transactions: readonly T[],
  byDay: ReadonlyMap<DateOnly, number>,
  today: DateOnly,
): { dayGroups: DayGroup<T>[]; scheduled: T[] } {
  const byDate = new Map<DateOnly, T[]>();
  const scheduled: T[] = [];
  for (const t of transactions) {
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
    .map(([date, list]) => ({ date, spentYen: byDay.get(date) ?? 0, transactions: list }));
  return {
    dayGroups,
    scheduled: scheduled.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn)),
  };
}

export type LedgerFilter = {
  /** ジャンルのid。'none' は未分類。null は絞らない。 */
  genreId: string | 'none' | null;
  /** 1日に絞る。 */
  date: DateOnly | null;
  accountId: string | null;
  /** 目標期間に絞る。 */
  range: LedgerRange | null;
  search: string;
};

export const EMPTY_FILTER: LedgerFilter = {
  genreId: null,
  date: null,
  accountId: null,
  range: null,
  search: '',
};

export function isFilterActive(f: LedgerFilter): boolean {
  return (
    f.genreId !== null ||
    f.date !== null ||
    f.accountId !== null ||
    f.range !== null ||
    f.search.trim() !== ''
  );
}

/** 明細が、そのジャンルを含むか(分割の子も見る)。 */
function hasGenre(t: LedgerTransaction, genreId: string | 'none'): boolean {
  const ids = t.splits.length > 0 ? t.splits.map((s) => s.genreId) : [t.genreId];
  return genreId === 'none' ? ids.some((id) => id === null) : ids.includes(genreId);
}

/** 絞り込み。search は店名・支店名・摘要・メモ・品目名の部分一致(大文字小文字・全半角を区別しない)。 */
export function filterLedger<T extends LedgerTransaction & { items?: readonly { name: string }[] }>(
  transactions: readonly T[],
  filter: LedgerFilter,
): T[] {
  const q = filter.search.normalize('NFKC').toLowerCase().trim();
  return transactions.filter((t) => {
    if (filter.date !== null && t.occurredOn !== filter.date) return false;
    if (
      filter.range !== null &&
      (t.occurredOn < filter.range.from || t.occurredOn > filter.range.to)
    )
      return false;
    if (filter.accountId !== null && t.accountId !== filter.accountId) return false;
    if (filter.genreId !== null && !hasGenre(t, filter.genreId)) return false;
    if (q !== '') {
      const hay = [
        t.label,
        t.branchName ?? '',
        t.description,
        t.memo ?? '',
        ...(t.items ?? []).map((i) => i.name),
      ]
        .join('\n')
        .normalize('NFKC')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type GenreShare = {
  genreId: string | null;
  genreName: string | null;
  amountYen: number;
  ratio: number;
};

/** 分割した明細の、ジャンルごとの比率(細い積み上げバー用)。分割が無ければ空。 */
export function splitShares(t: LedgerTransaction): GenreShare[] {
  if (t.splits.length < 2) return [];
  const total = t.splits.reduce((a, s) => a + Math.abs(s.amountYen), 0);
  if (total === 0) return [];
  const byGenre = new Map<string | null, GenreShare>();
  for (const s of t.splits) {
    const cur = byGenre.get(s.genreId) ?? {
      genreId: s.genreId,
      genreName: s.genreName,
      amountYen: 0,
      ratio: 0,
    };
    cur.amountYen += Math.abs(s.amountYen);
    byGenre.set(s.genreId, cur);
  }
  return [...byGenre.values()]
    .map((g) => ({ ...g, ratio: g.amountYen / total }))
    .sort((a, b) => b.amountYen - a.amountYen);
}

/** 行の2行目:支店名と品目のプレビュー。 */
export function rowSubtitle(t: LedgerTransaction, itemNames: readonly string[]): string {
  const preview =
    itemNames.slice(0, 3).join('、') +
    (itemNames.length > 3 ? ` ほか${itemNames.length - 3}点` : '');
  return [t.branchName, preview].filter((x): x is string => x !== null && x !== '').join(' ・ ');
}

export type AttentionSummary = {
  /** 未分類(目標に未反映)。 */
  uncategorized: { count: number; yen: number; ids: string[] };
  /** 金額不一致(レシートの照合で差額が残っているもの)。 */
  mismatch: { count: number; yen: number; ids: string[] };
};

/** 要確認の集計。実績の支出だけを数える(予定・収入・振替・対象外は除く)。 */
export function buildAttention(
  transactions: readonly LedgerTransaction[],
  today: DateOnly,
): AttentionSummary {
  const out: AttentionSummary = {
    uncategorized: { count: 0, yen: 0, ids: [] },
    mismatch: { count: 0, yen: 0, ids: [] },
  };
  for (const t of transactions) {
    if (!isCountable(asBudgetTx(t)) || t.amountYen >= 0) continue;
    if (entryStatus(t.occurredOn, today) !== 'actual') continue;
    const anyUncategorized = (
      t.splits.length > 0 ? t.splits.map((s) => s.genreId) : [t.genreId]
    ).some((id) => id === null);
    if (anyUncategorized) {
      out.uncategorized.count += 1;
      out.uncategorized.yen += -t.amountYen;
      out.uncategorized.ids.push(t.id);
    }
    if (t.reconcileDiffYen !== null && t.reconcileDiffYen !== 0) {
      out.mismatch.count += 1;
      out.mismatch.yen += Math.abs(t.reconcileDiffYen);
      out.mismatch.ids.push(t.id);
    }
  }
  return out;
}

/**
 * 絞り込み後の明細から、リスト用のグループを作る。日別の合計は、表示している
 * 明細を集計関数に通した値(絞り込み前のヘッダーの数字とは別物)。
 */
export function buildListModel<T extends LedgerTransaction>(
  transactions: readonly T[],
  today: DateOnly,
): { dayGroups: DayGroup<T>[]; scheduled: T[] } {
  const countable = transactions.filter((t) => isCountable(asBudgetTx(t)));
  if (countable.length === 0) return { dayGroups: [], scheduled: [] };
  const dates = countable.map((t) => t.occurredOn).sort();
  const summary = summarizeLedger(
    toLedgerEntries(countable),
    { from: dates[0]!, to: dates[dates.length - 1]! },
    today,
  );
  return groupForList(countable, summary.byDay, today);
}
