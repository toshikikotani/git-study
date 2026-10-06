import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
const rows: Record<string, unknown[]> = {};

function builder(table: string) {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
      }
      return (...args: unknown[]) => {
        const name = String(prop);
        if (['insert', 'update', 'delete', 'upsert'].includes(name)) {
          calls.push({ table, op: name, args });
        }
        return proxy;
      };
    },
  });
  return proxy;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const replaceSplits = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/features/transactions/splits-store', () => ({ replaceSplits }));
const recordCorrection = vi.hoisted(() => vi.fn(async () => {}));
const saveStoreRule = vi.hoisted(() => vi.fn(async () => {}));
const deleteRule = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/features/genre/memory-store', () => ({
  recordCorrection,
  saveStoreRule,
  deleteRule,
  listRulesForGenre: vi.fn(async () => []),
  updateRuleGenre: vi.fn(async () => {}),
}));

import {
  previewRuleAction,
  saveRuleAction,
  undoRuleAction,
} from '../../../app/(app)/spending/category/actions';

const tx = (
  id: string,
  date: string,
  description: string,
  merchant: string | null,
  yen: number,
  genre: string | null,
) => ({
  id,
  occurred_on: date,
  description,
  merchant_name: merchant,
  amount_yen: yen,
  genre_id: genre,
  classified_by: genre ? 'ai' : 'unclassified',
  review_status: 'auto_ok',
  reviewed_at: null,
});

beforeEach(() => {
  calls.length = 0;
  replaceSplits.mockClear();
  recordCorrection.mockClear();
  saveStoreRule.mockClear();
  deleteRule.mockClear();
  for (const k of Object.keys(rows)) delete rows[k];
  rows.genres = [
    { id: 'dining', name: '外食' },
    { id: 'cafe', name: 'カフェ' },
  ];
  rows.transactions = [
    tx('t1', '2026-09-03', 'ファミリーマート梅田店', 'ファミリーマート', -500, 'dining'),
    tx('t2', '2026-08-20', 'ﾌｧﾐﾘｰﾏｰﾄ', null, -300, null),
    tx('t3', '2026-08-10', 'ローソン', 'ローソン', -200, 'dining'),
    tx('t4', '2026-07-01', 'ファミリーマート', 'ファミリーマート', -100, 'cafe'),
  ];
  rows.receipt_items = [
    {
      transaction_id: 't1',
      name: "TULLY'S ブラック",
      id: 'i1',
      amount_yen: -500,
      genre_id: 'dining',
    },
    {
      transaction_id: 't2',
      name: 'ＴＵＬＬＹ’Ｓ ブラック',
      id: 'i2',
      amount_yen: -300,
      genre_id: null,
    },
  ];
  rows.transaction_splits = [];
});

describe('P7 ルールの事前確認(受け入れ基準11)', () => {
  it('品目ルール:一致する過去の取引の件数と一覧(店・品目の表記ゆれを無視、すでに移し先のものは除く)', async () => {
    const r = await previewRuleAction({
      scope: { kind: 'item', storeName: 'ファミリーマート', itemName: "TULLY'S ブラック" },
      toGenreId: 'cafe',
    });
    expect(r.error).toBeNull();
    expect(r.matches.map((m) => [m.id, m.genreName])).toEqual([
      ['t1', '外食'],
      ['t2', null],
    ]);
  });

  it('店ルール:同じ店のすべての取引(移し先にあるものを除く)', async () => {
    const r = await previewRuleAction({
      scope: { kind: 'store', storeName: 'ファミリーマート' },
      toGenreId: 'cafe',
    });
    expect(r.matches.map((m) => m.id)).toEqual(['t1', 't2']);
  });
});

describe('P7 ルールの保存(今後のみ / 過去の件にも)', () => {
  it('今後のみ:ルールだけ保存し、過去の取引は変えない', async () => {
    const r = await saveRuleAction({
      scope: { kind: 'item', storeName: 'ファミリーマート', itemName: "TULLY'S ブラック" },
      toGenreId: 'cafe',
      applyToPast: false,
    });
    expect(r).toEqual({ error: null, applied: 0 });
    expect(recordCorrection).toHaveBeenCalledWith({
      storeName: 'ファミリーマート',
      itemName: "TULLY'S ブラック",
      genreId: 'cafe',
      pin: true,
    });
    expect(calls.filter((c) => c.table === 'transactions')).toEqual([]);
  });

  it('過去の件にも:一致する取引を移し、移す前の状態を返す。店ルールは店ルールとして保存', async () => {
    const r = await saveRuleAction({
      scope: { kind: 'store', storeName: 'ファミリーマート' },
      toGenreId: 'cafe',
      applyToPast: true,
    });
    expect(r.error).toBeNull();
    expect(saveStoreRule).toHaveBeenCalledWith('ファミリーマート', 'cafe');
    expect(r.applied).toBe(2);
    expect(r.previous?.map((p) => p.id).sort()).toEqual(['t1', 't2']);
    const updates = calls.filter((c) => c.table === 'transactions' && c.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0]!.args[0]).toMatchObject({ genre_id: 'cafe', classified_by: 'manual' });
  });

  it('Undo:過去に当てた分を戻し、保存したルールを消す', async () => {
    rows.genre_memory = [{ id: 'rule1' }];
    const saved = await saveRuleAction({
      scope: { kind: 'store', storeName: 'ファミリーマート' },
      toGenreId: 'cafe',
      applyToPast: true,
    });
    calls.length = 0;
    const u = await undoRuleAction({
      scope: { kind: 'store', storeName: 'ファミリーマート' },
      ...(saved.previous ? { previous: saved.previous } : {}),
    });
    expect(u.error).toBeNull();
    expect(calls.filter((c) => c.table === 'transactions' && c.op === 'update')).toHaveLength(2);
    expect(deleteRule).toHaveBeenCalledWith('rule1');
  });
});
