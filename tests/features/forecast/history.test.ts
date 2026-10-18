import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase, type FakeTables } from '../../helpers/fake-supabase';

let current = fakeSupabase({});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => current.client }));

import { loadForecastHistory } from '@/features/forecast/history';
import { toForecastSource } from '@/features/forecast/source';
import { loadLedgerTransactions } from '@/features/spending/entries';

const RANGE = { from: '2026-09-01', to: '2026-09-30' };
const GENRES = [
  { id: 'drug', name: '日用品', budget_yen: null, sort_order: 1 },
  { id: 'cafe', name: 'カフェ・飲料', budget_yen: null, sort_order: 2 },
  { id: 'grocery', name: '食料品', budget_yen: null, sort_order: 3 },
];

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    occurred_on: '2026-09-20',
    created_at: '2026-09-21T17:00:00Z',
    description: id,
    merchant_name: null,
    amount_yen: -1000,
    genre_id: 'drug',
    is_transfer: false,
    review_status: 'auto_ok',
    account_id: 'a',
    payment_method: 'cash',
    must_pay: false,
    note: null,
    import_batch_id: null,
    kind: 'normal',
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T03:00:00Z'));
  current = fakeSupabase({ genres: GENRES, transactions: [] });
});
afterEach(() => vi.useRealTimers());

describe('loadForecastHistory(学習用のカテゴリを家計簿にそろえる)', () => {
  it('有効な分割だけを展開し、親のカテゴリと固定費を引き継ぎ、品目の代表カテゴリも使う', async () => {
    const tables: FakeTables = {
      genres: GENRES,
      transactions: [
        row('split', { amount_yen: -3000, must_pay: true, merchant_name: 'スーパー' }),
        row('items', { amount_yen: -1200, genre_id: null }),
        row('invalid', { amount_yen: -800 }),
        row('unclassified', { amount_yen: -900, genre_id: null }),
        row('refund', { amount_yen: 300, genre_id: 'cafe', kind: 'refund' }),
        row('special', { kind: 'special' }),
      ],
      transaction_splits: [
        { transaction_id: 'split', genre_id: null, amount_yen: -1200 },
        { transaction_id: 'split', genre_id: 'cafe', amount_yen: -1800 },
        { transaction_id: 'invalid', genre_id: 'cafe', amount_yen: -300 },
      ],
      receipt_items: [
        { transaction_id: 'items', genre_id: 'grocery', amount_yen: 700 },
        { transaction_id: 'items', genre_id: 'cafe', amount_yen: 500 },
        { transaction_id: 'unclassified', genre_id: null, amount_yen: 900 },
      ],
    };
    current = fakeSupabase(tables);
    const history = await loadForecastHistory(RANGE);
    const { transactions } = await loadLedgerTransactions(RANGE, '2026-10-18');
    const sort = <T extends { description: string; amountYen: number }>(rows: T[]) =>
      rows.sort((a, b) => a.description.localeCompare(b.description) || a.amountYen - b.amountYen);

    expect(sort(history)).toEqual(sort(toForecastSource(transactions)));
    expect(history.reduce((sum, t) => sum + t.amountYen, 0)).toBe(
      tables.transactions!.reduce((sum, t) => sum + (t.amount_yen as number), 0),
    );
    expect(history.filter((t) => t.description === 'split')).toMatchObject([
      { genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -1800, mustPay: true },
      { genreId: 'drug', genreName: '日用品', amountYen: -1200, mustPay: true },
    ]);
    expect(history.find((t) => t.description === 'items')).toMatchObject({
      genreId: 'grocery',
      genreName: '食料品',
      amountYen: -1200,
    });
    expect(history.find((t) => t.description === 'invalid')).toMatchObject({
      genreId: 'drug',
      amountYen: -800,
    });
    expect(history.find((t) => t.description === 'unclassified')).toMatchObject({
      genreId: null,
      genreName: null,
      amountYen: -900,
    });
    expect(history.every((t) => t.createdOn === '2026-09-22')).toBe(true);
  });

  it('壊れた分割がある未分類の親は、家計簿と同じく品目で再分類せず元の金額を残す', async () => {
    current = fakeSupabase({
      genres: GENRES,
      transactions: [row('broken', { genre_id: null, amount_yen: -1000 })],
      transaction_splits: [{ transaction_id: 'broken', genre_id: 'cafe', amount_yen: -100 }],
      receipt_items: [{ transaction_id: 'broken', genre_id: 'grocery', amount_yen: 1000 }],
    });
    expect(await loadForecastHistory(RANGE)).toMatchObject([
      { genreId: null, genreName: null, amountYen: -1000 },
    ]);
    expect(current.calls.some((c) => c.table === 'receipt_items')).toBe(false);
  });

  it('親にも子にもカテゴリが無ければ、未分類の子を落とさず合計を保つ', async () => {
    current = fakeSupabase({
      genres: GENRES,
      transactions: [row('split', { genre_id: null, amount_yen: -1000 })],
      transaction_splits: [
        { transaction_id: 'split', genre_id: null, amount_yen: -400 },
        { transaction_id: 'split', genre_id: 'cafe', amount_yen: -600 },
      ],
    });
    const history = await loadForecastHistory(RANGE);
    expect(history).toMatchObject([
      { genreId: null, genreName: null, amountYen: -400 },
      { genreId: 'cafe', genreName: 'カフェ・飲料', amountYen: -600 },
    ]);
    expect(history.reduce((sum, t) => sum + t.amountYen, 0)).toBe(-1000);
  });

  it('分割が合計1,000行を超えても50明細ずつ読み、カテゴリが途中で欠けない', async () => {
    current = fakeSupabase({
      genres: GENRES,
      transactions: Array.from({ length: 51 }, (_, i) =>
        row(`t${i}`, { amount_yen: -20, genre_id: 'drug' }),
      ),
      transaction_splits: Array.from({ length: 51 }, (_, i) =>
        Array.from({ length: 20 }, () => ({
          transaction_id: `t${i}`,
          genre_id: 'cafe',
          amount_yen: -1,
        })),
      ).flat(),
    });
    const history = await loadForecastHistory(RANGE);
    expect(history).toHaveLength(1020);
    expect(history.every((t) => t.genreId === 'cafe')).toBe(true);
    expect(history.reduce((sum, t) => sum + t.amountYen, 0)).toBe(-1020);
    expect(current.calls.filter((c) => c.table === 'transaction_splits')).toHaveLength(2);
  });

  it('同じ日付の履歴が1,000件を超えても、次のページまで欠けずに読む', async () => {
    current = fakeSupabase({
      genres: GENRES,
      transactions: Array.from({ length: 1001 }, (_, i) => row(`t${String(i).padStart(4, '0')}`)),
    });
    const history = await loadForecastHistory(RANGE);
    expect(history).toHaveLength(1001);
    expect(new Set(history.map((t) => t.description)).size).toBe(1001);
    expect(history.at(-1)?.description).toBe('t1000');
    expect(history.reduce((sum, t) => sum + t.amountYen, 0)).toBe(-1001000);
    expect(current.calls.filter((c) => c.table === 'transactions')).toHaveLength(2);
  });

  it('kind列が無ければ列を外して同じページを読み直し、固定費の印を保つ', async () => {
    current = fakeSupabase({
      genres: GENRES,
      transactions: [row('fixed', { kind: undefined, must_pay: true })],
    });
    const from = current.client.from;
    let first = true;
    current.client.from = (table: string) => {
      const query = from(table);
      if (table === 'transactions' && first) {
        first = false;
        query.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { code: '42703', message: 'kind does not exist' },
          }).then(resolve);
      }
      return query;
    };
    expect(await loadForecastHistory(RANGE)).toMatchObject([
      { kind: 'normal', mustPay: true, amountYen: -1000 },
    ]);
    const selects = current.calls.filter((c) => c.table === 'transactions').map((c) => c.select);
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain(', kind');
    expect(selects[1]).not.toContain(', kind');
  });

  it.each(['transaction_splits', 'receipt_items'])(
    '%sが未適用なら親の金額を保つ',
    async (table) => {
      current = fakeSupabase(
        { genres: GENRES, transactions: [row('parent', { genre_id: null })] },
        undefined,
        { [table]: { code: 'PGRST205', message: 'table not found' } },
      );
      expect(await loadForecastHistory(RANGE)).toMatchObject([{ genreId: null, amountYen: -1000 }]);
    },
  );

  it.each(['genres', 'transactions', 'transaction_splits', 'receipt_items'])(
    '%sの通常の取得エラーは学習データを黙って欠かさず伝える',
    async (table) => {
      current = fakeSupabase(
        { genres: GENRES, transactions: [row('parent', { genre_id: null })] },
        undefined,
        { [table]: { code: '42501', message: 'permission denied' } },
      );
      await expect(loadForecastHistory(RANGE)).rejects.toThrow('permission denied');
    },
  );
});
