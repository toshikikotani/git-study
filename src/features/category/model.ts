/**
 * カテゴリ詳細画面のデータの組み立て(純粋関数)。
 *
 * 集計は domain/ledger.ts の summarizeLedger() を通した値だけを使う(この画面独自の足し算を
 * しない)。明細を分割の子へ展開する toLedgerEntries() も家計簿と共通で、ここでは
 * 「このカテゴリに属する部分」を行(CategoryLine)として取り出す。
 *
 * 約束:
 *   - 行の金額は「このカテゴリに属する部分」だけ。分割したレシートは、このカテゴリの品目ぶんの額を持ち、
 *     レシート全体の額を receiptTotalYen に添える。
 *   - 返品・返金(kind='refund')は金額が正で、合計から差し引く(summarizeLedger と同じ)。
 *   - 取引・品目・店のどの見方でも、実績の行の合計は同じ(カテゴリの使った額)になる。
 *     品目は記録が無い/足りないぶんを「品目の記録なし」の行で埋めて、合計を崩さない。
 *   - 入力待ちのレシートは明細ではないので、ここには現れない(集計に含めない)。
 */

import { isCountable } from '@/domain/budget';
import { entryStatus, type LedgerRange, summarizeLedger } from '@/domain/ledger';
import { comparableKey } from '@/domain/store-name';
import type { ReceiptItem } from '@/features/receipts/items-store';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { toLedgerEntries } from '@/features/spending/views';
import type { DateOnly } from '@/lib/date';

/** 未分類のカテゴリを表すキー(URL・共有要素の名前にも使う)。 */
export const UNCATEGORIZED_KEY = 'none';

export type CategoryTx = LedgerTransaction & { items: readonly ReceiptItem[] };

export function genreIdOfKey(key: string): string | null {
  return key === UNCATEGORIZED_KEY ? null : key;
}
export function keyOfGenreId(genreId: string | null): string {
  return genreId ?? UNCATEGORIZED_KEY;
}

export type CategoryLine = {
  txId: string;
  occurredOn: DateOnly;
  /** 店名(正規化済み)。 */
  label: string;
  branchName: string | null;
  /**
   * このカテゴリに属する金額(符号付き)。支出は負、返品・返金は正。
   * 予定(未来日)の行も持つが、実績の合計には入らない。
   */
  amountYen: number;
  /** 分割したレシートのとき、レシート全体の額(正の数)。分割でなければ null。 */
  receiptTotalYen: number | null;
  status: 'actual' | 'scheduled';
  refund: boolean;
  special: boolean;
  tx: CategoryTx;
};

/**
 * カテゴリ(genreKey)に属する行。振替・対象外・入力待ち・収入は除く。
 * 期間 range の外の明細は含めない。
 */
export function buildCategoryLines(
  transactions: readonly CategoryTx[],
  genreKey: string,
  range: LedgerRange,
  today: DateOnly,
): CategoryLine[] {
  const genreId = genreIdOfKey(genreKey);
  const lines: CategoryLine[] = [];
  for (const t of transactions) {
    if (t.needsInput) continue;
    if (t.occurredOn < range.from || t.occurredOn > range.to) continue;
    if (
      !isCountable({
        categoryId: t.genreId,
        amountYen: t.amountYen,
        isTransfer: t.isTransfer,
        reviewStatus: t.reviewStatus,
      })
    )
      continue;
    const entries = toLedgerEntries([t]).filter((e) => e.categoryId === genreId);
    if (entries.length === 0) continue;
    const refund = t.kind === 'refund';
    // 収入(返金でない正の額)はカテゴリの支出ではない。
    const portion = entries.reduce((acc, e) => acc + e.amountYen, 0);
    if (portion > 0 && !refund) continue;
    const isSplit = t.splits.length > 0;
    lines.push({
      txId: t.id,
      occurredOn: t.occurredOn,
      label: t.label,
      branchName: t.branchName,
      amountYen: portion,
      receiptTotalYen:
        isSplit && entries.length > 0 && Math.abs(portion) !== Math.abs(t.amountYen)
          ? Math.abs(t.amountYen)
          : null,
      status: entryStatus(t.occurredOn, today),
      refund,
      special: t.kind === 'special',
      tx: t,
    });
  }
  return lines;
}

/** 実績の使った額(正の数)。返品・返金は差し引く。予定は含めない。 */
export function actualSpentYen(lines: readonly CategoryLine[]): number {
  return lines.reduce((acc, l) => (l.status === 'actual' ? acc - l.amountYen : acc), 0);
}

/** 予定(未来日)の支出(正の数)。 */
export function scheduledYen(lines: readonly CategoryLine[]): number {
  return lines.reduce(
    (acc, l) => (l.status === 'scheduled' && l.amountYen < 0 ? acc - l.amountYen : acc),
    0,
  );
}

/** 集計関数(summarizeLedger)から、このカテゴリの使った額を取る(家計簿のジャンル内訳と同じ値)。 */
export function categorySpentFromLedger(
  transactions: readonly CategoryTx[],
  genreKey: string,
  range: LedgerRange,
  today: DateOnly,
): number {
  const countable = transactions.filter((t) => !t.needsInput);
  const summary = summarizeLedger(toLedgerEntries(countable), range, today);
  return summary.byGenre.get(genreIdOfKey(genreKey)) ?? 0;
}

// ---- 取引の見方:日付ごと -----------------------------------------------------------

export type DayGroup = { date: DateOnly; spentYen: number; lines: CategoryLine[] };

/** 日付ごと(新しい日が先頭)。日の合計は実績の純額(返金は差し引く)。予定の日は合計を出さない(0)。 */
export function groupLinesByDay(
  lines: readonly CategoryLine[],
  order: 'newest' | 'amount' = 'newest',
): DayGroup[] {
  const byDate = new Map<DateOnly, CategoryLine[]>();
  for (const l of lines) {
    const list = byDate.get(l.occurredOn) ?? [];
    list.push(l);
    byDate.set(l.occurredOn, list);
  }
  const groups = [...byDate.entries()].map(([date, list]) => ({
    date,
    spentYen: actualSpentYen(list),
    lines: [...list].sort((a, b) =>
      order === 'amount' ? a.amountYen - b.amountYen : a.label.localeCompare(b.label, 'ja'),
    ),
  }));
  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

// ---- 品目の見方 ---------------------------------------------------------------------

export const NO_ITEM_KEY = '__no-item__';

/** 品目名の比較用の形(全半角・大文字小文字・空白・記号を区別しない)。 */
export function itemKeyOf(name: string): string {
  return comparableKey(name);
}

export type ItemOccurrence = {
  txId: string;
  occurredOn: DateOnly;
  storeKey: string;
  storeLabel: string;
  /** 品目の額(正の数。返金の行は負)。数量が分からないので、1行の額を「単価」として扱う。 */
  unitYen: number;
};

export type ItemAggregate = {
  key: string;
  name: string;
  count: number;
  totalYen: number;
  averageYen: number;
  occurrences: ItemOccurrence[];
};

/**
 * 品目ごとの集計(実績のみ)。品目の記録が無い/足りないぶんは「品目の記録なし」1行にまとめ、
 * 取引・店の見方と合計が一致するようにする。
 */
export function aggregateItems(lines: readonly CategoryLine[], genreKey: string): ItemAggregate[] {
  const genreId = genreIdOfKey(genreKey);
  const byKey = new Map<string, ItemAggregate>();
  let remainder = 0;
  let remainderCount = 0;

  for (const l of lines) {
    if (l.status !== 'actual') continue;
    const portion = -l.amountYen; // 支出は正、返金は負
    let counted = 0;
    const sign = l.refund ? -1 : 1;
    for (const item of l.tx.items) {
      const effective = item.genreId ?? l.tx.genreId;
      if (effective !== genreId) continue;
      const unit = sign * Math.abs(item.amountYen);
      counted += unit;
      const key = itemKeyOf(item.name);
      if (key === '') continue;
      const agg =
        byKey.get(key) ??
        ({
          key,
          name: item.name,
          count: 0,
          totalYen: 0,
          averageYen: 0,
          occurrences: [],
        } as ItemAggregate);
      agg.count += 1;
      agg.totalYen += unit;
      agg.occurrences.push({
        txId: l.txId,
        occurredOn: l.occurredOn,
        storeKey: comparableKey(l.label),
        storeLabel: l.label,
        unitYen: unit,
      });
      byKey.set(key, agg);
    }
    const rest = portion - counted;
    if (rest !== 0) {
      remainder += rest;
      remainderCount += 1;
    }
  }

  const rows = [...byKey.values()].map((a) => ({
    ...a,
    averageYen: a.count === 0 ? 0 : Math.round(a.totalYen / a.count),
  }));
  if (remainderCount > 0) {
    rows.push({
      key: NO_ITEM_KEY,
      name: '品目の記録なし',
      count: remainderCount,
      totalYen: remainder,
      averageYen: Math.round(remainder / remainderCount),
      occurrences: [],
    });
  }
  return rows.sort((a, b) => b.totalYen - a.totalYen);
}

// ---- 店の見方 -----------------------------------------------------------------------

export type StoreAggregate = {
  key: string;
  label: string;
  count: number;
  totalYen: number;
  averageYen: number;
  lastOn: DateOnly;
  txIds: string[];
};

/** 店ごとの集計(実績のみ、金額の多い順)。合計はカテゴリの使った額に一致する。 */
export function aggregateStores(lines: readonly CategoryLine[]): StoreAggregate[] {
  const byKey = new Map<string, StoreAggregate & { labels: Map<string, number> }>();
  for (const l of lines) {
    if (l.status !== 'actual') continue;
    const key = comparableKey(l.label) || l.label;
    const agg =
      byKey.get(key) ??
      ({
        key,
        label: l.label,
        count: 0,
        totalYen: 0,
        averageYen: 0,
        lastOn: l.occurredOn,
        txIds: [],
        labels: new Map(),
      } as StoreAggregate & { labels: Map<string, number> });
    agg.count += 1;
    agg.totalYen += -l.amountYen;
    if (l.occurredOn > agg.lastOn) agg.lastOn = l.occurredOn;
    agg.txIds.push(l.txId);
    agg.labels.set(l.label, (agg.labels.get(l.label) ?? 0) + 1);
    byKey.set(key, agg);
  }
  return [...byKey.values()]
    .map(({ labels, ...a }) => ({
      ...a,
      // 表記ゆれは、いちばん多い表記を店名にする。
      label: [...labels.entries()].sort((x, y) => y[1] - x[1])[0]![0],
      averageYen: a.count === 0 ? 0 : Math.round(a.totalYen / a.count),
    }))
    .sort((a, b) => b.totalYen - a.totalYen);
}
