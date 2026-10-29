/**
 * AI とつなぐ(MCP)の分析の道具の中身(ADR-147)。本人「AI 側で複雑な分析をしたい。いろんな情報を取得できたら
 * いろんな分析に使える」。
 *
 *   - analyzeData:明細を1〜2つの軸(月・週・日・曜日・カテゴリ・お店・口座)で集計する。数え方は明細・月の合計と
 *     同じ(振替・対象外・入力待ちは数えない、レシートの分割はカテゴリごと、返金は使った額から引く、予定は除く)。
 *   - receiptItemsData:レシートの品目(何をいくらで買ったか)を取り出し、品目ごと・お店ごとにまとめる。
 *   - overviewData:データの範囲・件数・口座・カテゴリ・目標の期間(分析の前に、何があるかを知る)。
 *
 * 長い期間は月ごとに分けて読む(1回の問い合わせの上限で、古い明細が抜けないように)。本人のセッションの中で呼ぶ。
 */
import 'server-only';

import { monthRange } from '@/domain/ledger';
import { comparableKey } from '@/domain/store-name';
import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { addDays, addMonths, daysBetween, todayJst, weekdayOf } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';

import { isListed, loadRange } from './data';

/** 分析できる期間の上限(日)。 */
export const MAX_ANALYZE_DAYS = 731;
export const DIMENSIONS = [
  'month',
  'week',
  'day',
  'weekday',
  'category',
  'store',
  'account',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const TIME_DIMENSIONS: readonly Dimension[] = ['month', 'week', 'day'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 期間をそろえる(既定は今月の1日から今日まで)。 */
export function analyzeRange(
  input: { from?: string | undefined; to?: string | undefined },
  today: string,
  maxDays = MAX_ANALYZE_DAYS,
): { from: string; to: string } {
  const to = input.to ?? today;
  const from = input.from ?? `${today.slice(0, 7)}-01`;
  if (from > to) throw new Error('from は to より前の日にしてください。');
  if (daysBetween(from, to) > maxDays) throw new Error(`期間は${maxDays}日までです。`);
  return { from, to };
}

/** 週の始まり(月曜)の日付。 */
export function weekStartOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export type AnalyzeInput = {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: Dimension[] | undefined;
  /** expense:使った額(返金を引く)。income:収入。 */
  type?: 'expense' | 'income' | undefined;
  category?: string | undefined;
  store?: string | undefined;
  account?: string | undefined;
  minYen?: number | undefined;
  maxYen?: number | undefined;
  includeScheduled?: boolean | undefined;
  excludeSpecial?: boolean | undefined;
  compareWith?: 'previous_period' | 'previous_year' | undefined;
  limit?: number | undefined;
};

/** 集計の1つ分(分割したレシートは、カテゴリごとに1つずつ)。 */
type Piece = {
  id: string;
  date: string;
  store: string;
  account: string;
  category: string;
  /** 数える向きの円(使った額は正、返金は負。収入は正)。 */
  yen: number;
  /** 件数に入れるか(返金は使った額から引くだけで、件数には入れない)。 */
  counted: boolean;
};

function piecesOf(
  transactions: readonly LedgerTransaction[],
  input: AnalyzeInput,
  range: { from: string; to: string },
  today: string,
  accountName: (id: string) => string,
): Piece[] {
  const mode = input.type ?? 'expense';
  const store = input.store?.trim() ? comparableKey(input.store) : '';
  const category = input.category?.trim().toLowerCase() ?? '';
  const account = input.account?.trim() ? comparableKey(input.account) : '';
  const pieces: Piece[] = [];
  for (const t of transactions) {
    if (!isListed(t)) continue;
    if (t.occurredOn < range.from || t.occurredOn > range.to) continue;
    if (!input.includeScheduled && t.occurredOn > today) continue;
    if (input.excludeSpecial && t.kind === 'special') continue;
    const isRefund = t.amountYen > 0 && t.kind === 'refund';
    if (mode === 'expense' && t.amountYen > 0 && !isRefund) continue;
    if (mode === 'income' && (t.amountYen < 0 || isRefund)) continue;
    const yen = Math.abs(t.amountYen);
    if (input.minYen !== undefined && yen < input.minYen) continue;
    if (input.maxYen !== undefined && yen > input.maxYen) continue;
    if (store && ![t.label, t.description].some((s) => comparableKey(s).includes(store))) continue;
    const accountLabel = accountName(t.accountId);
    if (account && !comparableKey(accountLabel).includes(account)) continue;
    const parts =
      t.splits.length > 0
        ? t.splits.map((s) => ({ category: s.genreName, amountYen: s.amountYen }))
        : [{ category: t.genreName, amountYen: t.amountYen }];
    for (const part of parts) {
      const name = part.category ?? '未分類';
      if (category && !name.toLowerCase().includes(category)) continue;
      pieces.push({
        id: t.id,
        date: t.occurredOn,
        store: t.label,
        account: accountLabel,
        category: name,
        yen: mode === 'expense' ? -part.amountYen : part.amountYen,
        counted: !isRefund,
      });
    }
  }
  return pieces;
}

function keyOf(piece: Piece, dimension: Dimension): string {
  switch (dimension) {
    case 'month':
      return piece.date.slice(0, 7);
    case 'week':
      return weekStartOf(piece.date);
    case 'day':
      return piece.date;
    case 'weekday':
      return WEEKDAYS[weekdayOf(piece.date)]!;
    case 'category':
      return piece.category;
    case 'store':
      return piece.store;
    case 'account':
      return piece.account;
  }
}

type Totals = { yen: number; count: number; averageYen: number | null };

function totalsOf(pieces: readonly Piece[]): Totals {
  const yen = pieces.reduce((n, p) => n + p.yen, 0);
  const count = new Set(pieces.filter((p) => p.counted).map((p) => p.id)).size;
  return { yen, count, averageYen: count > 0 ? Math.round(yen / count) : null };
}

/** 軸ごとに集計する(純粋関数)。 */
export function aggregate(
  pieces: readonly Piece[],
  groupBy: readonly Dimension[],
): { key: Record<string, string>; pieces: Piece[] }[] {
  const groups = new Map<string, { key: Record<string, string>; pieces: Piece[] }>();
  for (const p of pieces) {
    const key = Object.fromEntries(groupBy.map((d) => [d, keyOf(p, d)]));
    const id = JSON.stringify(key);
    const group = groups.get(id) ?? { key, pieces: [] };
    group.pieces.push(p);
    groups.set(id, group);
  }
  return [...groups.values()];
}

const WEEKDAY_ORDER = new Map(['月', '火', '水', '木', '金', '土', '日'].map((d, i) => [d, i]));

/** 集計の本体(読み込みと分けて、テストできるようにする)。 */
export function analyzeTransactions(
  transactions: readonly LedgerTransaction[],
  input: AnalyzeInput,
  range: { from: string; to: string },
  today: string,
  accountName: (id: string) => string,
  compare?: { transactions: readonly LedgerTransaction[]; range: { from: string; to: string } },
) {
  const groupBy = input.groupBy && input.groupBy.length > 0 ? input.groupBy.slice(0, 2) : [];
  const pieces = piecesOf(transactions, input, range, today, accountName);
  const total = totalsOf(pieces);
  const days = daysBetween(range.from, range.to) + 1;
  const timeFirst = groupBy[0] !== undefined && TIME_DIMENSIONS.includes(groupBy[0]);
  const hasTime = groupBy.some((d) => TIME_DIMENSIONS.includes(d));

  const comparePieces = compare
    ? piecesOf(compare.transactions, input, compare.range, today, accountName)
    : null;
  const compareGroups =
    comparePieces && !hasTime
      ? new Map(aggregate(comparePieces, groupBy).map((g) => [JSON.stringify(g.key), g.pieces]))
      : null;

  const rows = aggregate(pieces, groupBy).map((g) => {
    const t = totalsOf(g.pieces);
    const before = compareGroups?.get(JSON.stringify(g.key));
    const beforeYen = compareGroups ? (before ? totalsOf(before).yen : 0) : undefined;
    return {
      key: g.key,
      yen: t.yen,
      count: t.count,
      averageYen: t.averageYen,
      share: total.yen !== 0 ? Math.round((t.yen / total.yen) * 1000) / 1000 : null,
      ...(beforeYen !== undefined ? { compareYen: beforeYen, diffYen: t.yen - beforeYen } : {}),
    };
  });
  rows.sort((a, b) => {
    if (timeFirst) {
      const d = groupBy[0]!;
      const c = a.key[d]!.localeCompare(b.key[d]!);
      return c !== 0 ? c : b.yen - a.yen;
    }
    if (groupBy[0] === 'weekday') {
      return (
        (WEEKDAY_ORDER.get(a.key.weekday!) ?? 0) - (WEEKDAY_ORDER.get(b.key.weekday!) ?? 0) ||
        b.yen - a.yen
      );
    }
    return b.yen - a.yen;
  });

  const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const compareTotal = comparePieces ? totalsOf(comparePieces) : null;
  return {
    range,
    type: input.type ?? 'expense',
    groupBy,
    total: { ...total, days, perDayYen: Math.round(total.yen / days) },
    rows: shown,
    rowCount: rows.length,
    omitted:
      rest.length > 0 ? { rows: rest.length, yen: rest.reduce((n, r) => n + r.yen, 0) } : null,
    ...(compare && compareTotal
      ? {
          compare: {
            range: compare.range,
            total: compareTotal,
            diffYen: total.yen - compareTotal.yen,
            diffRate:
              compareTotal.yen !== 0
                ? Math.round(((total.yen - compareTotal.yen) / compareTotal.yen) * 1000) / 1000
                : null,
            ...(hasTime ? { note: '時間の軸で分けたときは、比べるのは合計だけです。' } : {}),
          },
        }
      : {}),
  };
}

/** 比べる期間(同じ長さの直前の期間か、1年前の同じ期間)。 */
export function compareRange(
  range: { from: string; to: string },
  how: 'previous_period' | 'previous_year',
): { from: string; to: string } {
  if (how === 'previous_year')
    return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** 集計する(analyze_spending)。 */
export async function analyzeData(input: AnalyzeInput) {
  const today = todayJst();
  const range = analyzeRange(input, today);
  const other = input.compareWith ? compareRange(range, input.compareWith) : null;
  const [current, before, accounts] = await Promise.all([
    loadRange(range.from, range.to, today),
    other ? loadRange(other.from, other.to, today) : Promise.resolve(null),
    listAccounts().catch(() => []),
  ]);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const result = analyzeTransactions(
    current.transactions,
    input,
    range,
    today,
    (id) => nameOf.get(id) ?? '口座なし',
    before && other ? { transactions: before.transactions, range: other } : undefined,
  );
  const truncated = [...current.truncatedMonths, ...(before?.truncatedMonths ?? [])];
  return {
    ...result,
    ...(truncated.length > 0
      ? { warning: `明細が多い月(${truncated.join('・')})は一部しか読めていないかもしれません。` }
      : {}),
  };
}

// ---- 品目 ------------------------------------------------------------------------

export type ReceiptItemsInput = {
  from?: string | undefined;
  to?: string | undefined;
  query?: string | undefined;
  store?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
};

type ItemRow = {
  recordId: string;
  date: string;
  store: string;
  name: string;
  /** 正の円(値引きの行は負)。 */
  yen: number;
  category: string | null;
};

/** 品目をしぼって、品目ごと・お店ごとにまとめる(純粋関数)。 */
export function summarizeItems(
  rows: readonly ItemRow[],
  input: ReceiptItemsInput,
): {
  count: number;
  totalYen: number;
  items: ItemRow[];
  byName: {
    name: string;
    count: number;
    totalYen: number;
    averageYen: number;
    minYen: number;
    maxYen: number;
    lastDate: string;
    stores: { store: string; count: number; averageYen: number; minYen: number }[];
  }[];
  byStore: { store: string; count: number; totalYen: number }[];
} {
  const q = input.query?.trim() ? comparableKey(input.query) : '';
  const store = input.store?.trim() ? comparableKey(input.store) : '';
  const cat = input.category?.trim().toLowerCase() ?? '';
  const hit = rows
    .filter((r) => !q || comparableKey(r.name).includes(q))
    .filter((r) => !store || comparableKey(r.store).includes(store))
    .filter((r) => !cat || (r.category ?? '未分類').toLowerCase().includes(cat))
    .sort((a, b) => b.date.localeCompare(a.date));

  const byKey = new Map<string, ItemRow[]>();
  for (const r of hit) {
    if (r.yen <= 0) continue; // 値引きの行は値段の比べには入れない
    const key = comparableKey(r.name);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const byName = [...byKey.values()]
    .map((list) => {
      const prices = list.map((r) => r.yen);
      const stores = new Map<string, number[]>();
      for (const r of list) stores.set(r.store, [...(stores.get(r.store) ?? []), r.yen]);
      const total = prices.reduce((n, y) => n + y, 0);
      return {
        name: list[0]!.name,
        count: list.length,
        totalYen: total,
        averageYen: Math.round(total / list.length),
        minYen: Math.min(...prices),
        maxYen: Math.max(...prices),
        lastDate: list[0]!.date,
        stores: [...stores]
          .map(([s, ys]) => ({
            store: s,
            count: ys.length,
            averageYen: Math.round(ys.reduce((n, y) => n + y, 0) / ys.length),
            minYen: Math.min(...ys),
          }))
          .sort((a, b) => b.count - a.count),
      };
    })
    .sort((a, b) => b.count - a.count || b.totalYen - a.totalYen)
    .slice(0, 50);

  const storeTotals = new Map<string, { count: number; totalYen: number }>();
  for (const r of hit) {
    const s = storeTotals.get(r.store) ?? { count: 0, totalYen: 0 };
    s.count += 1;
    s.totalYen += r.yen;
    storeTotals.set(r.store, s);
  }
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
  return {
    count: hit.length,
    totalYen: hit.reduce((n, r) => n + r.yen, 0),
    items: hit.slice(0, limit),
    byName,
    byStore: [...storeTotals]
      .map(([s, v]) => ({ store: s, ...v }))
      .sort((a, b) => b.totalYen - a.totalYen)
      .slice(0, 30),
  };
}

/** レシートの品目(get_receipt_items)。期間の既定は90日前から今日まで。 */
export async function receiptItemsData(input: ReceiptItemsInput) {
  const today = todayJst();
  const range = analyzeRange({ from: input.from ?? addDays(today, -89), to: input.to }, today);
  const { transactions, truncatedMonths } = await loadRange(range.from, range.to, today);
  const listed = transactions.filter((t) => isListed(t) && t.occurredOn <= today);
  const items = await listReceiptItemsForTransactionIds(listed.map((t) => t.id));
  const rows: ItemRow[] = [];
  for (const t of listed) {
    for (const item of items.get(t.id) ?? []) {
      rows.push({
        recordId: t.id,
        date: t.occurredOn,
        store: t.label,
        name: item.name,
        yen: -item.amountYen,
        category: item.genreName ?? t.genreName,
      });
    }
  }
  return {
    range,
    receiptsWithItems: items.size,
    ...summarizeItems(rows, input),
    ...(truncatedMonths.length > 0
      ? {
          warning: `明細が多い月(${truncatedMonths.join('・')})は一部しか読めていないかもしれません。`,
        }
      : {}),
  };
}

// ---- 概要 ------------------------------------------------------------------------

/** 何があるか(get_overview):データの範囲・件数・口座・カテゴリ・目標の期間。 */
export async function overviewData() {
  const today = todayJst();
  const supabase = await createClient();
  const [first, last, count, accounts, genres, plan] = await Promise.all([
    supabase.from('transactions').select('occurred_on').order('occurred_on').limit(1),
    supabase
      .from('transactions')
      .select('occurred_on')
      .lte('occurred_on', today)
      .order('occurred_on', { ascending: false })
      .limit(1),
    supabase.from('transactions').select('id', { count: 'exact', head: true }),
    listAccounts().catch(() => []),
    listGenres().catch(() => []),
    getCurrentPlan(today).catch(() => null),
  ]);
  const targetOf = new Map((plan?.items ?? []).map((i) => [i.genreId, i.targetYen]));
  return {
    today,
    records: {
      firstDate: first.data?.[0]?.occurred_on ?? null,
      lastDate: last.data?.[0]?.occurred_on ?? null,
      count: count.count ?? null,
    },
    period: plan
      ? { from: plan.periodStart, to: plan.periodEnd, hasGoal: true }
      : { ...monthRange(today.slice(0, 7)), hasGoal: false },
    categories: genres.map((g) => ({ name: g.name, targetYen: targetOf.get(g.id) ?? null })),
    accounts: accounts.map((a) => ({
      name: a.name,
      kind: a.kind,
      purpose: a.purpose,
      balanceYen: a.currentBalanceYen,
      closingDay: a.closingDay,
      paymentDay: a.paymentDay,
    })),
  };
}
