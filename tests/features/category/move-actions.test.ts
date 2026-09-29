import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
const rows: Record<string, unknown[]> = {};
let failUpdateOn: string | null = null;

function builder(table: string) {
  let op = 'select';
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: rows[table] ?? [], error: null, count: (rows[table] ?? []).length });
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
      }
      return (...args: unknown[]) => {
        const name = String(prop);
        if (['select', 'insert', 'update', 'delete'].includes(name)) {
          op = name;
          if (name !== 'select') calls.push({ table, op, args });
          if (name === 'update' && failUpdateOn === table) {
            return {
              eq: async () => ({ error: { message: 'boom' } }),
            };
          }
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

import {
  moveItemAction,
  moveTransactionsAction,
  restoreMovesAction,
  updateFieldsAction,
  restoreFieldsAction,
} from '../../../app/(app)/spending/category/actions';

beforeEach(() => {
  calls.length = 0;
  replaceSplits.mockClear();
  failUpdateOn = null;
  for (const k of Object.keys(rows)) delete rows[k];
  rows.transactions = [
    {
      id: 't1',
      amount_yen: -3000,
      genre_id: 'dining',
      classified_by: 'ai',
      review_status: 'auto_ok',
      reviewed_at: null,
      merchant_name: 'ドトール',
      occurred_on: '2026-09-20',
      note: null,
    },
  ];
  rows.transaction_splits = [
    { genre_id: 'dining', amount_yen: -1000, note: 'サンドイッチ' },
    { genre_id: 'cafe', amount_yen: -2000, note: 'コーヒー豆' },
  ];
  rows.receipt_items = [
    { id: 's', name: 'サンドイッチ', amount_yen: -1000, genre_id: 'dining' },
    { id: 'c', name: 'コーヒー豆', amount_yen: -2000, genre_id: 'cafe' },
  ];
});

describe('P6 カテゴリの移動の保存', () => {
  it('分割したレシート:このカテゴリの部分だけ移し、移す前の状態を返す(Undo 用)', async () => {
    const r = await moveTransactionsAction({
      ids: ['t1'],
      fromGenreId: 'dining',
      toGenreId: 'hobby',
    });
    expect(r.error).toBeNull();
    expect(replaceSplits).toHaveBeenCalledWith('t1', [
      { genreId: 'hobby', amountYen: -1000, note: 'サンドイッチ' },
      { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
    ]);
    const tx = calls.find((c) => c.table === 'transactions' && c.op === 'update')!;
    expect(tx.args[0]).toMatchObject({
      genre_id: 'cafe',
      classified_by: 'manual',
      review_status: 'corrected',
    });
    const items = calls.filter((c) => c.table === 'receipt_items' && c.op === 'update');
    expect(items.map((c) => c.args[0])).toEqual([{ genre_id: 'hobby' }]);
    expect(r.previous?.[0]).toMatchObject({
      id: 't1',
      genreId: 'dining',
      classifiedBy: 'ai',
      splits: [
        { genreId: 'dining', amountYen: -1000, note: 'サンドイッチ' },
        { genreId: 'cafe', amountYen: -2000, note: 'コーヒー豆' },
      ],
    });
  });

  it('Undo:移す前のジャンル・分類者・分割・品目のジャンルを書き戻す', async () => {
    const { previous } = await moveTransactionsAction({
      ids: ['t1'],
      fromGenreId: 'dining',
      toGenreId: 'hobby',
    });
    calls.length = 0;
    replaceSplits.mockClear();
    const r = await restoreMovesAction(previous!);
    expect(r.error).toBeNull();
    expect(
      calls.find((c) => c.table === 'transactions' && c.op === 'update')!.args[0],
    ).toMatchObject({
      genre_id: 'dining',
      classified_by: 'ai',
      review_status: 'auto_ok',
    });
    expect(replaceSplits).toHaveBeenCalledWith('t1', previous![0]!.splits);
  });

  it('保存に失敗したら、エラーを返し、半分だけ移った状態を残さない(previous は無い)', async () => {
    failUpdateOn = 'transactions';
    const failed = await moveTransactionsAction({
      ids: ['t1'],
      fromGenreId: 'dining',
      toGenreId: 'hobby',
    });
    expect(failed.error).toBeTruthy();
    expect(failed.previous).toBeUndefined();
  });

  it('複数件を一度に移せる(一括)。件数ぶんの変更前の状態を返す', async () => {
    const r = await moveTransactionsAction({
      ids: ['t1', 't1'],
      fromGenreId: 'dining',
      toGenreId: 'hobby',
    });
    expect(r.error).toBeNull();
    expect(r.previous).toHaveLength(2);
  });

  it('品目1つだけを移す:分割の内訳を作り直して保存し、合計は明細の金額のまま', async () => {
    const r = await moveItemAction({ transactionId: 't1', itemId: 's', toGenreId: 'hobby' });
    expect(r.error).toBeNull();
    const call = replaceSplits.mock.calls[0]! as unknown as [string, { amountYen: number }[]];
    expect(call[1].reduce((a, s) => a + s.amountYen, 0)).toBe(-3000);
    expect(
      calls.filter((c) => c.table === 'receipt_items' && c.op === 'update').map((c) => c.args[0]),
    ).toEqual([{ genre_id: 'hobby' }]);
    expect(r.previous).toHaveLength(1);
  });

  it('存在しない品目・合計が金額を超える品目は、エラーを返して何も書かない', async () => {
    const missing = await moveItemAction({
      transactionId: 't1',
      itemId: 'zzz',
      toGenreId: 'hobby',
    });
    expect(missing.error).toContain('品目が見つかりません');
    expect(replaceSplits).not.toHaveBeenCalled();
  });
});

describe('P6 金額・日付・店名・メモの編集の保存', () => {
  it('変更前の値を返し、書き戻せる', async () => {
    rows.transaction_splits = [];
    const r = await updateFieldsAction('t1', {
      amountYen: -3500,
      occurredOn: '2026-09-21',
      merchantName: ' ドトール梅田 ',
      note: 'メモ',
    });
    expect(r.error).toBeNull();
    expect(r.previous).toMatchObject({
      id: 't1',
      amountYen: -3000,
      occurredOn: '2026-09-20',
      merchantName: 'ドトール',
      note: null,
    });
    const upd = calls.find((c) => c.table === 'transactions' && c.op === 'update')!;
    expect(upd.args[0]).toEqual({
      amount_yen: -3500,
      occurred_on: '2026-09-21',
      merchant_name: 'ドトール梅田',
      note: 'メモ',
    });
    calls.length = 0;
    expect((await restoreFieldsAction(r.previous!)).error).toBeNull();
    expect(calls.find((c) => c.op === 'update')!.args[0]).toEqual({
      amount_yen: -3000,
      occurred_on: '2026-09-20',
      merchant_name: 'ドトール',
      note: null,
    });
  });

  it('分割したレシートの金額は変えられない。空の店名・不正な日付・0円も弾く', async () => {
    const split = await updateFieldsAction('t1', { amountYen: -100 });
    expect(split.error).toContain('分割を解除してから');
    rows.transaction_splits = [];
    expect((await updateFieldsAction('t1', { merchantName: '  ' })).error).toBe(
      '店名を入力してください。',
    );
    expect((await updateFieldsAction('t1', { occurredOn: '9/21' })).error).toBe(
      '日付が正しくありません。',
    );
    expect((await updateFieldsAction('t1', { amountYen: 0 })).error).toContain('0以外の整数');
  });
});
