/**
 * AI とつなぐ(MCP)の書く道具(ADR-144):記録する・レシートを入れる・カテゴリを直す・目標を変える・取り消す。
 * 画面と同じ保存の関数を使い、同じ支払いかもしれないときは記録せずに返す。取り消せるのは AI で入れた記録だけ。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

vi.mock('server-only', () => ({}));

const s = vi.hoisted(() => ({
  client: null as unknown,
  tables: {} as Record<string, Record<string, unknown>[]>,
  imported: [] as Record<string, unknown>[],
  existing: [] as Record<string, unknown>[],
  splits: [] as unknown[],
  items: [] as unknown[],
  updated: [] as unknown[],
  corrections: [] as unknown[],
  planTargets: [] as unknown[],
  added: [] as unknown[],
  plan: null as null | {
    id: string;
    periodStart: string;
    periodEnd: string;
    items: { genreId: string; targetYen: number }[];
  },
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => s.client }));
vi.mock('@/lib/date', async (original) => ({
  ...(await original<typeof import('@/lib/date')>()),
  todayJst: () => '2026-10-27',
}));
vi.mock('@/features/genre/store', () => ({
  listGenres: async () => [
    { id: 'food', name: '食料品' },
    { id: 'dining', name: '外食' },
    { id: 'daily', name: '日用品' },
    { id: 'cafe', name: 'カフェ・飲料' },
  ],
}));
vi.mock('@/features/accounts/store', () => ({
  getOrCreateDefaultAccount: async () => ({ id: 'cash', name: '現金' }),
  listAccounts: async () => [
    { id: 'cash', name: '現金' },
    { id: 'card', name: '楽天カード' },
  ],
}));
vi.mock('@/features/spending/entries', () => ({
  loadLedgerTransactions: async () => ({
    genres: [],
    transactions: s.existing,
    batchIdByTransactionId: new Map(),
  }),
}));
vi.mock('@/features/transactions/store', () => ({
  importTransactions: async (rows: Record<string, unknown>[]) => {
    s.imported.push(...rows);
    return {
      importedCount: rows.length,
      duplicateCount: 0,
      insertedTransactions: rows.map((r, i) => ({ id: `new-${i}`, sourceRef: r.sourceRef })),
    };
  },
  updateTransaction: async (...args: unknown[]) => {
    s.updated.push(args);
  },
}));
vi.mock('@/features/transactions/splits-store', () => ({
  replaceSplits: async (...args: unknown[]) => {
    s.splits.push(args);
  },
}));
vi.mock('@/features/receipts/items-store', () => ({
  replaceReceiptItems: async (...args: unknown[]) => {
    s.items.push(args);
  },
}));
vi.mock('@/features/genre/memory-store', () => ({
  recordCorrection: async (input: unknown) => {
    s.corrections.push(input);
  },
}));
vi.mock('@/features/spending-plan/store', () => ({
  getCurrentPlan: async () => s.plan,
  updatePlanTargets: async (...args: unknown[]) => {
    s.planTargets.push(args);
  },
}));
vi.mock('@/features/spending-plan/membership', () => ({
  addPlanGenre: async (...args: unknown[]) => {
    s.added.push(args);
  },
}));
vi.mock('@/features/goals/category-outlook', () => ({
  loadCategoryOutlooks: async () => ({ outlooks: [{ spentYen: 12000, scheduledYen: 3000 }] }),
}));

import {
  addReceipt,
  addRecord,
  MCP_REF_PREFIX,
  resolveGenre,
  setCategory,
  setTarget,
  undoRecord,
} from '@/features/mcp/write';

const ledger = (over: Record<string, unknown>) => ({
  id: 'x',
  occurredOn: '2026-10-27',
  label: 'ライフ',
  amountYen: -1800,
  isTransfer: false,
  reviewStatus: 'auto_ok',
  needsInput: false,
  ...over,
});

beforeEach(() => {
  s.imported = [];
  s.existing = [];
  s.splits = [];
  s.items = [];
  s.updated = [];
  s.corrections = [];
  s.planTargets = [];
  s.added = [];
  s.plan = {
    id: 'plan-1',
    periodStart: '2026-10-25',
    periodEnd: '2026-11-24',
    items: [{ genreId: 'dining', targetYen: 15000 }],
  };
  const tables: FakeTables = {
    transactions: [
      {
        id: 'old',
        user_id: 'me',
        source_ref: null,
        occurred_on: '2026-10-20',
        merchant_name: 'ドンキ',
        description: 'ドン・キホーテ',
        amount_yen: -1280,
      },
      {
        id: 'mine',
        user_id: 'me',
        source_ref: 'mcp-abc',
        occurred_on: '2026-10-27',
        merchant_name: '松屋',
        description: '松屋',
        amount_yen: -780,
      },
    ],
  };
  s.tables = tables;
  s.client = fakeSupabase(tables, { id: 'me' }).client;
});

describe('カテゴリの名前', () => {
  const genres = [
    { id: 'food', name: '食料品' },
    { id: 'dining', name: '外食' },
    { id: 'cafe', name: 'カフェ・飲料' },
  ];
  it('全部一致 → 部分一致が1つ。決まらなければ候補を付けて断る', () => {
    expect(resolveGenre(genres, '外食').id).toBe('dining');
    expect(resolveGenre(genres, 'カフェ').id).toBe('cafe');
    expect(() => resolveGenre(genres, '服')).toThrow(/ありません.*食料品、外食、カフェ・飲料/);
  });
});

describe('記録する', () => {
  it('支出は負の金額・手入力として1件入れ、AI で入れた印(mcp-)と取り消し方を返す', async () => {
    const r = await addRecord({
      type: 'expense',
      amountYen: 1200,
      store: 'ランチ',
      category: '外食',
    });
    expect(r).toMatchObject({
      status: 'recorded',
      record: {
        id: 'new-0',
        date: '2026-10-27',
        store: 'ランチ',
        yen: 1200,
        type: 'expense',
        category: '外食',
      },
    });
    expect(r.note).toContain('undo_record');
    expect(s.imported[0]).toMatchObject({
      amountYen: -1200,
      genreId: 'dining',
      classifiedBy: 'manual',
      source: 'manual',
      accountId: 'cash',
    });
    expect(String(s.imported[0]!.sourceRef)).toMatch(new RegExp(`^${MCP_REF_PREFIX}`));
  });

  it('支出はカテゴリが要る。収入は要らない。口座は名前で選べる', async () => {
    await expect(addRecord({ type: 'expense', amountYen: 500 })).rejects.toThrow(
      /カテゴリが要ります/,
    );
    await addRecord({ type: 'income', amountYen: 280000, store: '給与', account: '楽天' });
    expect(s.imported[0]).toMatchObject({ amountYen: 280000, accountId: 'card', genreId: null });
    await expect(addRecord({ type: 'expense', amountYen: 0, category: '外食' })).rejects.toThrow();
    await expect(
      addRecord({ type: 'expense', amountYen: 500, category: '外食', date: '10/27' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('同じ日に同じ金額があれば記録せず候補を返す。本人が別だと言えば allowDuplicate で入れる', async () => {
    s.existing = [ledger({ id: 'card-1', label: 'ﾗｲﾌ', amountYen: -1200 })];
    const held = await addRecord({
      type: 'expense',
      amountYen: 1200,
      store: 'ライフ',
      category: '食料品',
    });
    expect(held).toMatchObject({
      status: 'not_recorded_possible_duplicate',
      candidates: [{ id: 'card-1', date: '2026-10-27', store: 'ﾗｲﾌ', yen: 1200 }],
    });
    expect(s.imported).toEqual([]);
    const saved = await addRecord({
      type: 'expense',
      amountYen: 1200,
      store: 'ライフ',
      category: '食料品',
      allowDuplicate: true,
    });
    expect(saved.status).toBe('recorded');
  });
});

describe('レシートを入れる', () => {
  it('品目が2つ以上なら品目ごとのカテゴリで分け、品目も残す', async () => {
    const r = await addReceipt({
      store: 'マツモトキヨシ',
      date: '2026-10-26',
      totalYen: 1340,
      items: [
        { name: 'ティッシュ', yen: 400, category: '日用品' },
        { name: '水', yen: 940, category: '食料品' },
      ],
    });
    expect(r).toMatchObject({ status: 'recorded', record: { yen: 1340, store: 'マツモトキヨシ' } });
    expect(s.imported[0]).toMatchObject({ amountYen: -1340, occurredOn: '2026-10-26' });
    const splits = (s.splits[0] as [string, { genreId: string; amountYen: number }[]])[1];
    expect(splits.map((x) => [x.genreId, x.amountYen])).toEqual([
      ['daily', -400],
      ['food', -940],
    ]);
    expect(s.items).toHaveLength(1);
  });

  it('品目の合計が少し違えば「調整」の行を足し、大きく違えば断る', async () => {
    await addReceipt({
      store: 'ライフ',
      date: '2026-10-27',
      totalYen: 1100,
      category: '食料品',
      items: [
        { name: '牛乳', yen: 500 },
        { name: 'パン', yen: 500 },
      ],
    });
    const items = (s.items[0] as [string, { name: string; amountYen: number }[]])[1];
    expect(items.at(-1)).toMatchObject({ name: '調整(税など)', amountYen: -100 });
    await expect(
      addReceipt({
        store: 'ライフ',
        date: '2026-10-27',
        totalYen: 3000,
        category: '食料品',
        items: [{ name: '牛乳', yen: 500 }],
      }),
    ).rejects.toThrow(/合いません/);
  });

  it('カテゴリが1つも無ければ断る', async () => {
    await expect(
      addReceipt({ store: 'ライフ', date: '2026-10-27', totalYen: 500 }),
    ).rejects.toThrow(/カテゴリが要ります/);
  });
});

describe('カテゴリを直す・目標を変える', () => {
  it('明細のカテゴリを変え、次から同じお店はそのカテゴリになりやすくする', async () => {
    const r = await setCategory({ id: 'old', category: '日用品' });
    expect(s.updated).toEqual([['old', 'daily']]);
    expect(s.corrections).toEqual([{ storeName: 'ドンキ', itemName: 'ドンキ', genreId: 'daily' }]);
    expect(r).toMatchObject({ status: 'updated', record: { category: '日用品', yen: 1280 } });
    await expect(setCategory({ id: 'nope', category: '日用品' })).rejects.toThrow(/見つかりません/);
  });

  it('目標額は使った額と予定の合計より下にはできない。目標に無いカテゴリは足す', async () => {
    await expect(setTarget({ category: '外食', targetYen: 14000 })).rejects.toThrow(/15,000円/);
    const r = await setTarget({ category: '外食', targetYen: 20000 });
    expect(s.planTargets).toEqual([['plan-1', [{ genreId: 'dining', targetYen: 20000 }]]]);
    expect(r).toMatchObject({ previousTargetYen: 15000, targetYen: 20000 });
    await setTarget({ category: 'カフェ', targetYen: 16000 });
    expect(s.added).toEqual([['plan-1', 'cafe', 16000, null]]);
    s.plan = null;
    await expect(setTarget({ category: '外食', targetYen: 20000 })).rejects.toThrow(
      /目標がまだありません/,
    );
  });
});

describe('取り消す', () => {
  it('AI で入れた記録だけ消せる', async () => {
    await expect(undoRecord({ id: 'old' })).rejects.toThrow(/AI から入れた記録だけ/);
    expect(s.tables.transactions!.map((r) => r.id)).toContain('old');
    const r = await undoRecord({ id: 'mine' });
    expect(r).toMatchObject({ status: 'deleted', record: { store: '松屋', yen: 780 } });
    expect(s.tables.transactions!.map((r) => r.id)).not.toContain('mine');
  });
});
