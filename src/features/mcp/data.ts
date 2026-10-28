/**
 * AI とつなぐ(MCP)の道具が返す中身(ADR-142)。どれも読むだけ。数字は家計簿の画面と同じ関数で数える
 * (今日の目安は iPhone 版と同じ loadMobileToday、カテゴリは「カテゴリ」⑦と同じ loadCategoryOutlooks、
 * 月の合計は明細と同じ summarizeLedger)。本人のセッションの中で呼ぶ。
 *
 * AI が読み違えないよう、金額はすべて正の円にして、支出・収入・返金・予定は種類で分ける。
 */
import 'server-only';

import { monthRange, summarizeLedger } from '@/domain/ledger';
import { subscriptionKeyOf } from '@/domain/subscriptions';
import { loadCategoryOutlooks } from '@/features/goals/category-outlook';
import { needsInputSummary } from '@/features/home/pending';
import { loadMobileToday } from '@/features/mobile/today';
import { listReadyReceipts } from '@/features/receipt-captures/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { toLedgerEntries } from '@/features/spending/views';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, daysBetween, todayJst } from '@/lib/date';
import { getAppBaseUrl } from '@/lib/env';

/** 1回に返す明細の上限。 */
export const MAX_ROWS = 100;
/** さがせる期間の上限(日)。 */
export const MAX_RANGE_DAYS = 400;

export type RecordRow = {
  date: string;
  store: string;
  /** 正の円。 */
  yen: number;
  type: 'expense' | 'income' | 'refund';
  category: string | null;
  /** 今日より先の予定(使った額には入らない)。 */
  scheduled: boolean;
  memo?: string;
};

/** 振替・対象外・入力待ちを除いた、数える明細か。 */
export function isListed(t: LedgerTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored' && !t.needsInput && t.amountYen !== 0;
}

export function toRow(t: LedgerTransaction, today: string): RecordRow {
  return {
    date: t.occurredOn,
    store: t.label,
    yen: Math.abs(t.amountYen),
    type: t.amountYen < 0 ? 'expense' : t.kind === 'refund' ? 'refund' : 'income',
    category: t.genreName,
    scheduled: t.occurredOn > today,
    ...(t.memo ? { memo: t.memo } : {}),
  };
}

export type SearchInput = {
  from?: string | undefined;
  to?: string | undefined;
  query?: string | undefined;
  category?: string | undefined;
  minYen?: number | undefined;
  maxYen?: number | undefined;
  type?: 'expense' | 'income' | 'refund' | undefined;
  limit?: number | undefined;
};

/** 期間の既定(今月の1日から今日まで)と上限をそろえる。 */
export function searchRange(input: SearchInput, today: string): { from: string; to: string } {
  const to = input.to ?? today;
  const from = input.from ?? `${today.slice(0, 7)}-01`;
  if (from > to) throw new Error('from は to より前の日にしてください。');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new Error(`さがせる期間は${MAX_RANGE_DAYS}日までです。`);
  }
  return { from, to };
}

/** 明細をしぼる(お店・メモ・カテゴリの名前は部分一致、大文字小文字は区別しない)。新しい順。 */
export function filterRecords(
  transactions: readonly LedgerTransaction[],
  input: SearchInput,
  today: string,
): {
  count: number;
  totals: { expenseYen: number; incomeYen: number; refundYen: number };
  rows: RecordRow[];
} {
  const q = input.query?.trim().toLowerCase() ?? '';
  const cat = input.category?.trim().toLowerCase() ?? '';
  const rows = transactions
    .filter(isListed)
    .map((t) => ({ t, row: toRow(t, today) }))
    .filter(({ t, row }) => {
      if (q && ![t.label, t.description, t.memo ?? ''].some((s) => s.toLowerCase().includes(q)))
        return false;
      if (cat && !(row.category ?? '未分類').toLowerCase().includes(cat)) return false;
      if (input.type && row.type !== input.type) return false;
      if (input.minYen !== undefined && row.yen < input.minYen) return false;
      if (input.maxYen !== undefined && row.yen > input.maxYen) return false;
      return true;
    })
    .map(({ row }) => row)
    .sort((a, b) => b.date.localeCompare(a.date));
  const totals = { expenseYen: 0, incomeYen: 0, refundYen: 0 };
  for (const r of rows) {
    if (r.scheduled) continue;
    totals[`${r.type}Yen` as const] += r.yen;
  }
  const limit = Math.min(Math.max(1, input.limit ?? 30), MAX_ROWS);
  return { count: rows.length, totals, rows: rows.slice(0, limit) };
}

const appLink = (path: string) => {
  const base = getAppBaseUrl();
  return base === null ? null : `${base}${path}`;
};

/** 今日の目安・明日からの目安・今期の見通し・今日の記録・片づけること。 */
export async function todayData(userId: string) {
  const t = await loadMobileToday(userId);
  return {
    today: t.today,
    todayAllowance:
      t.allowance === null
        ? null
        : t.allowance.kind === 'left'
          ? { status: 'can_spend', yen: t.allowance.yen }
          : { status: 'over', yen: t.allowance.yen },
    provisional: t.provisional,
    perDayFromTomorrowYen: t.tomorrowYen,
    period:
      t.outlook === null
        ? null
        : {
            label: t.outlook.periodLabel,
            spentYen: t.outlook.spentYen,
            forecastYen: t.outlook.p50Yen,
            budgetYen: t.outlook.budgetYen,
            probabilityWithinBudget: t.outlook.probWithin,
          },
    todo: t.todo,
    todayRecords: t.records.map((r) => ({
      store: r.label,
      yen: Math.abs(r.amountYen),
      type: r.amountYen < 0 ? 'expense' : 'income',
      category: r.genreName,
    })),
    appUrl: appLink('/'),
  };
}

/** カテゴリごとの今期(目標の期間。目標が無ければ今月)。category で名前をしぼれる。 */
export async function categoryData(category?: string) {
  const today = todayJst();
  const plan = await getCurrentPlan(today).catch(() => null);
  const { period, remainingDays, outlooks } = await loadCategoryOutlooks({ plan, today });
  const q = category?.trim().toLowerCase() ?? '';
  return {
    today,
    period: { ...period, remainingDaysIncludingToday: remainingDays, hasGoal: plan !== null },
    categories: outlooks
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .map((o) => ({
        name: o.name,
        targetYen: o.untargeted ? null : o.targetYen,
        spentYen: o.spentYen,
        scheduledYen: o.scheduledYen,
        forecastYen: o.p50,
        forecastRangeYen: o.p10 !== null && o.p90 !== null ? [o.p10, o.p90] : null,
        lastMonthYen: o.lastMonthYen,
        likelyOverTarget: o.caution !== null,
        probabilityOverTarget: o.caution?.probability ?? null,
        fixedCost: o.fixed,
        note: o.sub,
      })),
  };
}

/** 月の合計(支出・収入・収支・予定)とカテゴリごとの使った額。month は 'YYYY-MM'。 */
export async function monthData(month?: string) {
  const today = todayJst();
  const key = month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))
    throw new Error('month は YYYY-MM で指定してください。');
  const range = monthRange(key);
  const { genres, transactions } = await loadLedgerTransactions(range, today);
  const summary = summarizeLedger(toLedgerEntries(transactions), range, today);
  const nameOf = new Map(genres.map((g) => [g.id, g.name]));
  return {
    month: key,
    range,
    spentYen: summary.spentYen,
    incomeYen: summary.incomeYen,
    netYen: summary.incomeYen - summary.spentYen,
    scheduledYen: summary.scheduledYen,
    recordCount: transactions.filter(isListed).length,
    byCategory: [...summary.byGenre.entries()]
      .filter(([, yen]) => yen !== 0)
      .map(([id, yen]) => ({
        category: id === null ? '未分類' : (nameOf.get(id) ?? '未分類'),
        yen,
      }))
      .sort((a, b) => b.yen - a.yen),
  };
}

/** 明細をさがす。 */
export async function searchData(input: SearchInput) {
  const today = todayJst();
  const range = searchRange(input, today);
  const { transactions } = await loadLedgerTransactions(range, today);
  return { range, ...filterRecords(transactions, input, today) };
}

/** これからの予定と固定費(明日から days 日先まで、近い順)。 */
export async function upcomingData(days = 31) {
  const today = todayJst();
  const ahead = Math.min(Math.max(1, days), 92);
  const [{ transactions }, fixedKeys] = await Promise.all([
    loadLedgerTransactions({ from: addDays(today, 1), to: addDays(today, ahead) }, today),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
  ]);
  const isFixed = (t: LedgerTransaction) =>
    fixedKeys.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
    (t.genreId !== null && fixedKeys.has(`genre:${t.genreId}`));
  const rows = transactions
    .filter((t) => isListed(t) && t.occurredOn > today && t.amountYen < 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))
    .map((t) => ({ ...toRow(t, today), fixedCost: isFixed(t) }));
  return {
    today,
    to: addDays(today, ahead),
    totalYen: rows.reduce((n, r) => n + r.yen, 0),
    payments: rows.slice(0, MAX_ROWS),
  };
}

/** 確かめること(答え合わせ・保存前のレシート・入力待ち)。保存はアプリで本人がする。 */
export async function needsCheckData(userId: string) {
  const [today, ready, waiting] = await Promise.all([
    loadMobileToday(userId),
    listReadyReceipts().catch(() => []),
    needsInputSummary(),
  ]);
  return {
    todayCheckCount: today.todo.checkCount,
    unsavedReceipts: ready.map((r) => ({
      store: (r.parsed.storeName ?? '').trim() || r.parsed.description,
      date: r.parsed.occurredOn,
      yen: Math.abs(r.parsed.amountYen),
    })),
    receiptsNeedingInput: waiting.count,
    note: '保存前のレシートは、アプリで確かめて「保存」を押すまで明細に入りません。',
    appUrl: appLink('/spending/review'),
  };
}
