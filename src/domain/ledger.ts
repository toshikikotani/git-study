/**
 * 家計簿の集計を担う唯一の関数群。
 *
 * ヘッダー・ジャンル内訳・明細・カレンダー・目標・AI診断は、どれも
 * ここの summarizeLedger() を通した数字だけを表示する。画面ごとに
 * 別々に足し算すると、同じ期間なのに合計が食い違う(31,542円と63,082円、
 * 12,279円と12,656円)ため。
 *
 * 集計の約束:
 *   - 振替・対象外(ignored)は数えない(domain/budget.ts の isCountable)
 *   - 今日より未来の日付は自動で scheduled(予定)。実績には含めず、別に持つ
 *   - kind='special'(特別費)は「使った額」には入るが、目標のペース計算
 *     (paceSpentYen)には入れない
 *   - 金額は整数の円だけ。小数が来たら例外にする(浮動小数点を混ぜない)
 *   - 分割した明細は子(splits)へ展開して数える。子のジャンルが未設定なら
 *     親のジャンルを引き継ぐ
 */

import { isCountable, type BudgetTransaction } from '@/domain/budget';
import { assertYen } from '@/domain/money';
import { addDays, type DateOnly } from '@/lib/date';

export type EntryStatus = 'actual' | 'scheduled';
export type EntryKind = 'normal' | 'special';

/** 集計の入力1行。明細1件、または分割の子1件。 */
export type LedgerEntry = BudgetTransaction & {
  /** 元の明細のid(分割の子も親のidを持つ)。 */
  id: string;
  occurredOn: DateOnly;
  kind: EntryKind;
};

/** 日付だけで決まる実効の状態。今日を含む過去は実績、明日以降は予定。 */
export function entryStatus(occurredOn: DateOnly, today: DateOnly): EntryStatus {
  return occurredOn > today ? 'scheduled' : 'actual';
}

export type LedgerParent = LedgerEntry & { label?: string };

/**
 * 明細を分割の子へ展開する。分割が無ければそのまま。子のジャンルが null なら
 * 親のジャンルを引き継ぐ(個別に付けたジャンルはそのまま活かす)。
 * 種別(kind)・日付・状態に関わる値は親から引き継ぐ。
 */
export function expandLedger<T extends LedgerEntry>(
  transactions: readonly T[],
  splitsByTransactionId: ReadonlyMap<
    string,
    readonly { genreId: string | null; amountYen: number }[]
  >,
): T[] {
  return transactions.flatMap((t) => {
    const splits = splitsByTransactionId.get(t.id);
    if (!splits || splits.length === 0) return [t];
    return splits.map((s) => ({
      ...t,
      categoryId: s.genreId ?? t.categoryId,
      amountYen: s.amountYen,
    }));
  });
}

export type LedgerRange = { from: DateOnly; to: DateOnly };

export type LedgerSummary = {
  range: LedgerRange;
  /** 使った額(実績の支出、特別費を含む)。正の数。 */
  spentYen: number;
  /** 実績の収入。正の数。 */
  incomeYen: number;
  /** うち特別費。目標のペース計算からは外す。 */
  specialYen: number;
  /** 特別費を除いた使った額。目標のペース・予測にはこちらを使う。 */
  paceSpentYen: number;
  /** 期間内の予定(未来日)の支出。実績には含めない。正の数。 */
  scheduledYen: number;
  /** ジャンル別の使った額(特別費を含む)。キー null は未分類。 */
  byGenre: ReadonlyMap<string | null, number>;
  /** ジャンル別の使った額(特別費を除く)。目標のジャンル進捗に使う。 */
  byGenrePace: ReadonlyMap<string | null, number>;
  /** 日別の使った額(実績のみ)。 */
  byDay: ReadonlyMap<DateOnly, number>;
  /** 日別の予定の支出。 */
  scheduledByDay: ReadonlyMap<DateOnly, number>;
  /** 未分類の使った額(byGenre の null と同じ値)。 */
  uncategorizedYen: number;
};

function add<K>(map: Map<K, number>, key: K, yen: number): void {
  map.set(key, (map.get(key) ?? 0) + yen);
}

/**
 * 期間 [from, to] の集計。全画面の合計はここから出す。
 * today は「実績か予定か」の境目(呼び出し側が todayJst() を渡す)。
 */
export function summarizeLedger(
  entries: readonly LedgerEntry[],
  range: LedgerRange,
  today: DateOnly,
): LedgerSummary {
  let spentYen = 0;
  let incomeYen = 0;
  let specialYen = 0;
  let scheduledYen = 0;
  const byGenre = new Map<string | null, number>();
  const byGenrePace = new Map<string | null, number>();
  const byDay = new Map<DateOnly, number>();
  const scheduledByDay = new Map<DateOnly, number>();

  for (const e of entries) {
    if (e.occurredOn < range.from || e.occurredOn > range.to) continue;
    if (!isCountable(e)) continue;
    assertYen(e.amountYen, '明細の金額');

    const yen = -e.amountYen;
    if (entryStatus(e.occurredOn, today) === 'scheduled') {
      if (yen > 0) {
        scheduledYen += yen;
        add(scheduledByDay, e.occurredOn, yen);
      }
      continue;
    }

    if (e.amountYen > 0) {
      incomeYen += e.amountYen;
      continue;
    }
    spentYen += yen;
    add(byGenre, e.categoryId, yen);
    add(byDay, e.occurredOn, yen);
    if (e.kind === 'special') {
      specialYen += yen;
    } else {
      add(byGenrePace, e.categoryId, yen);
    }
  }

  return {
    range,
    spentYen,
    incomeYen,
    specialYen,
    paceSpentYen: spentYen - specialYen,
    scheduledYen,
    byGenre,
    byGenrePace,
    byDay,
    scheduledByDay,
    uncategorizedYen: byGenre.get(null) ?? 0,
  };
}

/** 月('YYYY-MM')の範囲。 */
export function monthRange(monthKey: string): LedgerRange {
  const from = `${monthKey}-01`;
  let to = from;
  // 月末を求める(翌月1日の前日)。
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  to = addDays(next, -1);
  return { from, to };
}

/** 集計対象(振替・対象外を除く)の実績の支出だけを取り出す。明細一覧の「実績」側に使う。 */
export function isActualEntry(e: LedgerEntry, today: DateOnly): boolean {
  return isCountable(e) && entryStatus(e.occurredOn, today) === 'actual';
}
