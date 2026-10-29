/**
 * AI とつなぐ(MCP)の分析の道具(ADR-147):集計(軸・クロス集計・前の期間との比べ)、レシートの品目、概要。
 * 数え方は家計簿の画面(summarizeLedger)と同じ。長い期間は月ごとに分けて読む。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { monthRange, summarizeLedger } from '@/domain/ledger';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { toLedgerEntries } from '@/features/spending/views';

import { fakeSupabase } from '../../helpers/fake-supabase';

vi.mock('server-only', () => ({}));

const s = vi.hoisted(() => ({
  loads: [] as { from: string; to: string }[],
  byMonth: new Map<string, unknown[]>(),
  items: new Map<string, unknown[]>(),
  client: null as unknown,
}));

vi.mock('@/lib/date', async (original) => ({
  ...(await original<typeof import('@/lib/date')>()),
  todayJst: () => '2026-10-29',
}));
vi.mock('@/features/spending/entries', () => ({
  loadLedgerTransactions: async (range: { from: string; to: string }) => {
    s.loads.push(range);
    const month = s.byMonth.get(range.from.slice(0, 7)) ?? [];
    return {
      genres: [],
      transactions: (month as LedgerTransaction[]).filter(
        (t) => t.occurredOn >= range.from && t.occurredOn <= range.to,
      ),
      batchIdByTransactionId: new Map(),
    };
  },
}));
vi.mock('@/features/accounts/store', () => ({
  listAccounts: async () => [
    {
      id: 'cash',
      name: '現金',
      kind: 'cash',
      purpose: 'spending',
      currentBalanceYen: 12000,
      closingDay: null,
      paymentDay: null,
    },
    {
      id: 'card',
      name: '楽天カード',
      kind: 'credit_card',
      purpose: 'spending',
      currentBalanceYen: -45000,
      closingDay: 25,
      paymentDay: 27,
    },
  ],
}));
vi.mock('@/features/receipts/items-store', () => ({
  listReceiptItemsForTransactionIds: async (ids: string[]) =>
    new Map([...s.items].filter(([id]) => ids.includes(id))),
}));
vi.mock('@/features/genre/store', () => ({
  listGenres: async () => [
    { id: 'food', name: '食料品' },
    { id: 'dining', name: '外食' },
  ],
}));
vi.mock('@/features/spending-plan/store', () => ({
  getCurrentPlan: async () => ({
    id: 'p',
    periodStart: '2026-10-01',
    periodEnd: '2026-11-05',
    items: [{ genreId: 'food', targetYen: 40000 }],
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => s.client }));

import {
  analyzeRange,
  analyzeTransactions,
  compareRange,
  overviewData,
  receiptItemsData,
  summarizeItems,
  weekStartOf,
} from '@/features/mcp/analysis';
import { loadRange, searchData } from '@/features/mcp/data';

let n = 0;
function tx(over: Partial<LedgerTransaction>): LedgerTransaction {
  n += 1;
  return {
    id: `t${n}`,
    occurredOn: '2026-10-10',
    label: 'ライフ',
    description: 'ライフ',
    memo: null,
    thumbnailUrl: null,
    genreId: 'food',
    genreName: '食料品',
    amountYen: -1000,
    accountId: 'cash',
    paymentMethod: 'one_time',
    branchName: null,
    reconcileDiffYen: null,
    mustPay: false,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    status: 'actual',
    kind: 'normal',
    needsInput: false,
    splits: [],
    ...over,
  } as LedgerTransaction;
}

const accountName = (id: string) => ({ cash: '現金', card: '楽天カード' })[id] ?? '口座なし';
const TODAY = '2026-10-29';

function sample(): LedgerTransaction[] {
  return [
    tx({ occurredOn: '2026-10-03', amountYen: -1200 }), // 金曜 食料品 ライフ 現金
    tx({
      occurredOn: '2026-10-04',
      label: 'マツキヨ',
      description: 'マツモトキヨシ',
      amountYen: -3000,
      accountId: 'card',
      genreId: 'food',
      splits: [
        { id: 's1', note: null, genreId: 'daily', genreName: '日用品', amountYen: -1000 },
        { id: 's2', note: null, genreId: 'food', genreName: '食料品', amountYen: -2000 },
      ],
    }),
    tx({
      occurredOn: '2026-10-05',
      label: '松屋',
      genreId: 'dining',
      genreName: '外食',
      amountYen: -800,
    }),
    tx({ occurredOn: '2026-10-06', label: 'ライフ', amountYen: 300, kind: 'refund' }), // 返金
    tx({ occurredOn: '2026-10-07', label: '振替', amountYen: -50000, isTransfer: true }),
    tx({ occurredOn: '2026-10-08', label: '対象外', amountYen: -999, reviewStatus: 'ignored' }),
    tx({
      occurredOn: '2026-10-09',
      label: '給与',
      genreId: null,
      genreName: null,
      amountYen: 280000,
    }),
    tx({ occurredOn: '2026-11-02', label: '予定', amountYen: -5000 }), // 予定
    tx({ occurredOn: '2026-10-20', label: '旅行', amountYen: -20000, kind: 'special' }),
  ];
}

beforeEach(() => {
  n = 0;
  s.loads = [];
  s.byMonth = new Map();
  s.items = new Map();
});

describe('集計(analyze_spending)', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' };

  it('カテゴリごとの合計は、家計簿の月の合計(summarizeLedger)と同じ', () => {
    const txs = sample();
    const r = analyzeTransactions(txs, { groupBy: ['category'] }, range, TODAY, accountName);
    const app = summarizeLedger(toLedgerEntries(txs), monthRange('2026-10'), TODAY);
    const appByName = new Map([
      ['食料品', app.byGenre.get('food')],
      ['日用品', app.byGenre.get('daily')],
      ['外食', app.byGenre.get('dining')],
    ]);
    expect(r.total.yen).toBe(app.spentYen);
    for (const row of r.rows) expect(row.yen).toBe(appByName.get(row.key.category!));
    // 食料品 = 1200 + 2000(分割) − 300(返金) + 20000(特別費)
    expect(r.rows[0]).toMatchObject({ key: { category: '食料品' }, yen: 22900, count: 3 });
  });

  it('件数は明細の数(分割したレシートも1件)、返金は件数に入れず額だけ引く。予定・振替・対象外は数えない', () => {
    const r = analyzeTransactions(sample(), {}, range, TODAY, accountName);
    expect(r.total).toMatchObject({ yen: 1200 + 3000 + 800 - 300 + 20000, count: 4, days: 31 });
    expect(r.total.averageYen).toBe(Math.round(24700 / 4));
    const withScheduled = analyzeTransactions(
      sample(),
      { includeScheduled: true },
      { from: '2026-10-01', to: '2026-11-30' },
      TODAY,
      accountName,
    );
    expect(withScheduled.total.yen).toBe(24700 + 5000);
    const noSpecial = analyzeTransactions(
      sample(),
      { excludeSpecial: true },
      range,
      TODAY,
      accountName,
    );
    expect(noSpecial.total.yen).toBe(4700);
  });

  it('お店・口座・曜日・収入で分けられ、しぼれる', () => {
    const byStore = analyzeTransactions(
      sample(),
      { groupBy: ['store'] },
      range,
      TODAY,
      accountName,
    );
    expect(byStore.rows.map((r) => [r.key.store, r.yen])).toEqual([
      ['旅行', 20000],
      ['マツキヨ', 3000],
      ['ライフ', 900],
      ['松屋', 800],
    ]);
    const byAccount = analyzeTransactions(
      sample(),
      { groupBy: ['account'], excludeSpecial: true },
      range,
      TODAY,
      accountName,
    );
    expect(byAccount.rows.map((r) => [r.key.account, r.yen])).toEqual([
      ['楽天カード', 3000],
      ['現金', 1700],
    ]);
    const weekday = analyzeTransactions(
      sample(),
      { groupBy: ['weekday'] },
      range,
      TODAY,
      accountName,
    );
    expect(weekday.rows.map((r) => r.key.weekday)).toEqual(['月', '火', '土', '日']);
    const filtered = analyzeTransactions(
      sample(),
      { store: 'マツモト', account: '楽天', category: '日用' },
      range,
      TODAY,
      accountName,
    );
    expect(filtered.total).toMatchObject({ yen: 1000, count: 1 });
    const income = analyzeTransactions(sample(), { type: 'income' }, range, TODAY, accountName);
    expect(income.total).toMatchObject({ yen: 280000, count: 1 });
  });

  it('クロス集計は時間の軸が先なら時間の順。行が多ければ残りをまとめる', () => {
    const txs = [
      tx({ occurredOn: '2026-09-10', amountYen: -500 }),
      tx({ occurredOn: '2026-10-10', amountYen: -700 }),
      tx({ occurredOn: '2026-09-11', genreId: 'dining', genreName: '外食', amountYen: -900 }),
    ];
    const r = analyzeTransactions(
      txs,
      { groupBy: ['month', 'category'] },
      { from: '2026-09-01', to: '2026-10-31' },
      TODAY,
      accountName,
    );
    expect(r.rows.map((x) => [x.key.month, x.key.category, x.yen])).toEqual([
      ['2026-09', '外食', 900],
      ['2026-09', '食料品', 500],
      ['2026-10', '食料品', 700],
    ]);
    const limited = analyzeTransactions(
      txs,
      { groupBy: ['day'], limit: 1 },
      { from: '2026-09-01', to: '2026-10-31' },
      TODAY,
      accountName,
    );
    expect(limited.rows).toHaveLength(1);
    expect(limited.omitted).toEqual({ rows: 2, yen: 1600 });
  });

  it('前の期間と比べ、行ごとの差も返す(時間の軸のときは合計だけ)', () => {
    const now = [tx({ occurredOn: '2026-10-10', amountYen: -3000 })];
    const before = [
      tx({ occurredOn: '2026-09-10', amountYen: -1000 }),
      tx({
        occurredOn: '2026-09-12',
        label: '松屋',
        genreId: 'dining',
        genreName: '外食',
        amountYen: -500,
      }),
    ];
    const other = compareRange(range, 'previous_period');
    expect(other).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    const r = analyzeTransactions(now, { groupBy: ['category'] }, range, TODAY, accountName, {
      transactions: before,
      range: other,
    });
    expect(r.rows).toEqual([
      expect.objectContaining({
        key: { category: '食料品' },
        yen: 3000,
        compareYen: 1000,
        diffYen: 2000,
      }),
    ]);
    expect(r.compare).toMatchObject({ total: { yen: 1500 }, diffYen: 1500, diffRate: 1 });
    const timed = analyzeTransactions(now, { groupBy: ['month'] }, range, TODAY, accountName, {
      transactions: before,
      range: other,
    });
    expect(timed.rows[0]).not.toHaveProperty('compareYen');
    expect(timed.compare?.note).toContain('合計だけ');
    expect(compareRange(range, 'previous_year')).toEqual({ from: '2025-10-01', to: '2025-10-31' });
  });

  it('週は月曜始まり。期間は今月1日から今日までが既定で、長すぎれば断る', () => {
    expect(weekStartOf('2026-10-29')).toBe('2026-10-26');
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(analyzeRange({}, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-29' });
    expect(() => analyzeRange({ from: '2024-01-01' }, TODAY)).toThrow(/731日/);
    expect(() => analyzeRange({ from: '2026-10-10', to: '2026-10-01' }, TODAY)).toThrow(/前の日/);
  });
});

describe('長い期間は月ごとに読む', () => {
  it('月の境目で分けて読み、1,000件に届いた月は抜けがあるかもしれないと知らせる', async () => {
    s.byMonth.set(
      '2026-02',
      Array.from({ length: 1000 }, () => tx({ occurredOn: '2026-02-10' })),
    );
    const r = await loadRange('2026-01-15', '2026-03-10', TODAY);
    expect(s.loads).toEqual([
      { from: '2026-01-15', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-10' },
    ]);
    expect(r.transactions).toHaveLength(1000);
    expect(r.truncatedMonths).toEqual(['2026-02']);
  });

  it('明細をさがす(search_transactions)も月ごとに読む', async () => {
    s.byMonth.set('2026-09', [tx({ occurredOn: '2026-09-20', label: 'セブン' })]);
    s.byMonth.set('2026-10', [tx({ occurredOn: '2026-10-20', label: 'セブン' })]);
    const r = await searchData({ from: '2026-09-01', query: 'セブン' });
    expect(r.count).toBe(2);
    expect(s.loads).toHaveLength(2);
  });
});

describe('レシートの品目(get_receipt_items)', () => {
  const rows = [
    {
      recordId: 'a',
      date: '2026-10-01',
      store: 'ライフ',
      name: '牛乳',
      yen: 240,
      category: '食料品',
    },
    {
      recordId: 'b',
      date: '2026-10-08',
      store: 'イオン',
      name: 'ｷﾞｭｳﾆｭｳ',
      yen: 198,
      category: '食料品',
    },
    {
      recordId: 'b',
      date: '2026-10-08',
      store: 'イオン',
      name: '牛乳',
      yen: 210,
      category: '食料品',
    },
    {
      recordId: 'b',
      date: '2026-10-08',
      store: 'イオン',
      name: '値引き',
      yen: -50,
      category: null,
    },
    {
      recordId: 'c',
      date: '2026-10-15',
      store: 'ライフ',
      name: 'ティッシュ',
      yen: 400,
      category: '日用品',
    },
  ];

  it('品目ごとに回数・平均・最安・最高・お店ごとをまとめる(値引きの行は値段の比べに入れない)', () => {
    const r = summarizeItems(rows, { query: '牛乳' });
    expect(r.count).toBe(2);
    expect(r.items.map((i) => i.date)).toEqual(['2026-10-08', '2026-10-01']);
    expect(r.byName[0]).toMatchObject({
      name: '牛乳',
      count: 2,
      averageYen: 225,
      minYen: 210,
      maxYen: 240,
      lastDate: '2026-10-08',
    });
    expect(r.byName[0]!.stores.map((x) => [x.store, x.minYen])).toEqual([
      ['イオン', 210],
      ['ライフ', 240],
    ]);
    const all = summarizeItems(rows, {});
    expect(all.totalYen).toBe(240 + 198 + 210 - 50 + 400);
    expect(all.byName.map((x) => x.name)).not.toContain('値引き');
    expect(summarizeItems(rows, { store: 'ライフ', category: '日用' }).count).toBe(1);
    // 半角カナも同じ品名として探せる
    expect(summarizeItems(rows, { query: 'ギュウニュウ' }).count).toBe(1);
  });

  it('期間の明細の品目を読み、金額は正の円にする(既定は90日前から)', async () => {
    s.byMonth.set('2026-10', [tx({ id: 'r1', occurredOn: '2026-10-20', label: 'ライフ' })]);
    s.items.set('r1', [
      {
        id: 'i1',
        name: '卵',
        amountYen: -298,
        genreId: 'food',
        genreName: '食料品',
        productType: null,
      },
    ]);
    const r = await receiptItemsData({});
    expect(r.range).toEqual({ from: '2026-08-01', to: '2026-10-29' });
    expect(r.receiptsWithItems).toBe(1);
    expect(r.items).toEqual([
      {
        recordId: 'r1',
        date: '2026-10-20',
        store: 'ライフ',
        name: '卵',
        yen: 298,
        category: '食料品',
      },
    ]);
  });
});

describe('概要(get_overview)', () => {
  it('データの始まり・最後・件数、今期、カテゴリと目標額、口座と残高', async () => {
    s.client = fakeSupabase({
      transactions: [
        { id: '1', occurred_on: '2025-04-02' },
        { id: '2', occurred_on: '2026-10-28' },
        { id: '3', occurred_on: '2026-11-05' },
      ],
    }).client;
    const r = await overviewData();
    expect(r.records).toEqual({ firstDate: '2025-04-02', lastDate: '2026-10-28', count: 3 });
    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-11-05', hasGoal: true });
    expect(r.categories).toEqual([
      { name: '食料品', targetYen: 40000 },
      { name: '外食', targetYen: null },
    ]);
    expect(r.accounts[1]).toMatchObject({ name: '楽天カード', balanceYen: -45000, closingDay: 25 });
  });
});
