/**
 * カテゴリ詳細の一覧まわりの純粋関数(並び替え・検索・仮想化する行の平坦化・品目の詳細)。
 */

import { comparableKey } from '@/domain/store-name';
import type { DateOnly } from '@/lib/date';
import {
  groupLinesByDay,
  type CategoryLine,
  type ItemAggregate,
  type ItemOccurrence,
} from './model';

export type LineSort = 'newest' | 'amount';

/** カテゴリ内の検索(店名・支店名・品目・メモ。全半角・大文字小文字を区別しない)。 */
export function searchLines(lines: readonly CategoryLine[], query: string): CategoryLine[] {
  const q = query.normalize('NFKC').toLowerCase().trim();
  if (q === '') return [...lines];
  return lines.filter((l) => {
    const hay = [l.label, l.branchName ?? '', l.tx.memo ?? '', ...l.tx.items.map((i) => i.name)]
      .join('\n')
      .normalize('NFKC')
      .toLowerCase();
    return hay.includes(q);
  });
}

export type ListRow =
  | {
      kind: 'header';
      key: string;
      date: DateOnly;
      spentYen: number;
      /** その日が予定(未来日)だけか。合計は出さず「予定」と表示する。 */
      scheduledOnly: boolean;
    }
  | { kind: 'line'; key: string; line: CategoryLine };

/**
 * 取引の一覧を、仮想化できる1本の行の並びにする。
 *   newest : 日付ごと(新しい日が先頭)、日付の見出しにその日の合計(返品は差し引く)
 *   amount : 金額の多い順(見出しなし。返品・返金は最後)
 */
export function flattenRows(lines: readonly CategoryLine[], sort: LineSort): ListRow[] {
  if (sort === 'amount') {
    return [...lines]
      .sort((a, b) => a.amountYen - b.amountYen || b.occurredOn.localeCompare(a.occurredOn))
      .map((line) => ({ kind: 'line' as const, key: `l:${line.txId}`, line }));
  }
  const rows: ListRow[] = [];
  for (const g of groupLinesByDay(lines)) {
    rows.push({
      kind: 'header',
      key: `h:${g.date}`,
      date: g.date,
      spentYen: g.spentYen,
      scheduledOnly: g.lines.every((l) => l.status === 'scheduled'),
    });
    for (const line of g.lines) rows.push({ kind: 'line', key: `l:${line.txId}`, line });
  }
  return rows;
}

/** いま見えている先頭の行が属する日付の見出し(上部に固定して見せる)。 */
export function stickyHeaderFor(rows: readonly ListRow[], firstVisible: number): ListRow | null {
  for (let i = Math.min(firstVisible, rows.length - 1); i >= 0; i--) {
    if (rows[i]!.kind === 'header') return rows[i]!;
  }
  return null;
}

// ---- 品目の詳細 ------------------------------------------------------------------------

export type PricePoint = { date: DateOnly; unitYen: number; storeLabel: string };

export type StorePrice = {
  key: string;
  label: string;
  count: number;
  averageYen: number;
  lowestYen: number;
  cheapest: boolean;
};

export type ItemDetail = {
  name: string;
  count: number;
  totalYen: number;
  averageYen: number;
  /** 単価の推移(日付順)。 */
  points: PricePoint[];
  /** 店ごとの単価(安い順)。最安の店に印。店が1つだけなら比較にならないので印は付けない。 */
  stores: StorePrice[];
  txIds: string[];
};

export function buildItemDetail(name: string, occurrences: readonly ItemOccurrence[]): ItemDetail {
  const points = [...occurrences]
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
    .map((o) => ({ date: o.occurredOn, unitYen: o.unitYen, storeLabel: o.storeLabel }));
  const byStore = new Map<string, { label: string; units: number[] }>();
  for (const o of occurrences) {
    const key = o.storeKey || comparableKey(o.storeLabel);
    const e = byStore.get(key) ?? { label: o.storeLabel, units: [] };
    e.units.push(o.unitYen);
    byStore.set(key, e);
  }
  const stores = [...byStore.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      count: e.units.length,
      averageYen: Math.round(e.units.reduce((a, b) => a + b, 0) / e.units.length),
      lowestYen: Math.min(...e.units),
      cheapest: false,
    }))
    .sort((a, b) => a.averageYen - b.averageYen);
  if (stores.length >= 2 && stores[0]) stores[0].cheapest = true;
  const totalYen = occurrences.reduce((a, o) => a + o.unitYen, 0);
  return {
    name,
    count: occurrences.length,
    totalYen,
    averageYen: occurrences.length === 0 ? 0 : Math.round(totalYen / occurrences.length),
    points,
    stores,
    txIds: [...new Set(occurrences.map((o) => o.txId))],
  };
}

/** 折れ線(SVG)の座標。値が同じなら水平の線にする。 */
export function sparklinePoints(
  points: readonly PricePoint[],
  width: number,
  height: number,
  pad = 4,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const ys = points.map((p) => p.unitYen);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min;
  return points.map((p, i) => ({
    x: points.length === 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2),
    y: span === 0 ? height / 2 : pad + (1 - (p.unitYen - min) / span) * (height - pad * 2),
  }));
}

/** 品目の一覧から、名前のキーで1件引く。 */
export function findItem(items: readonly ItemAggregate[], key: string): ItemAggregate | undefined {
  return items.find((i) => i.key === key);
}
