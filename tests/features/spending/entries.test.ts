import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockClient, type MockResult } from '../../helpers/supabase-mock';

/**
 * 明細の読み込み(loadLedgerTransactions):分割の子のジャンル継承、予定(未来日)、
 * kind 列が未適用のときのフォールバック。
 */

let tables: Record<string, MockResult | (() => MockResult)> = {};

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient(tables) }));
vi.mock('@/features/genre/item-genres', () => ({ resolveItemGenres: async () => new Map() }));

import { loadLedgerTransactions } from '@/features/spending/entries';
import { loadGenreSpend } from '@/features/spending-plan/store';

const genres = [
  { id: 'drug', name: '日用品', budget_yen: null },
  { id: 'cafe', name: 'カフェ・飲料', budget_yen: null },
  { id: 'event', name: '発表会', budget_yen: null },
];

function row(o: Record<string, unknown>) {
  return {
    id: 't',
    occurred_on: '2026-09-20',
    description: 'x',
    merchant_name: null,
    amount_yen: -1000,
    genre_id: 'drug',
    is_transfer: false,
    review_status: 'auto_ok',
    account_id: 'a',
    payment_method: 'one_time',
    must_pay: false,
    note: null,
    import_batch_id: null,
    kind: 'normal',
    ...o,
  };
}

beforeEach(() => {
  tables = {};
});

describe('loadLedgerTransactions', () => {
  it('分割の子のジャンルが未設定なら親のジャンルを引き継ぐ(「未分類」の子を作らない)', async () => {
    tables = {
      genres: { data: genres, error: null },
      transactions: {
        data: [row({ id: 'p', merchant_name: 'ココカラファイン', amount_yen: -3000 })],
        error: null,
      },
      transaction_splits: {
        data: [
          { transaction_id: 'p', genre_id: null, amount_yen: -1200 },
          { transaction_id: 'p', genre_id: 'cafe', amount_yen: -1800 },
        ],
        error: null,
      },
    };
    const { transactions } = await loadLedgerTransactions(
      { from: '2026-09-01', to: '2026-09-30' },
      '2026-09-29',
    );
    expect(transactions[0]!.splits.map((s) => [s.genreId, s.genreName, s.amountYen])).toEqual([
      ['drug', '日用品', -1200],
      ['cafe', 'カフェ・飲料', -1800],
    ]);
  });

  it('分割の合計が明細の金額と合わないときは分割として扱わない(集計がずれるため)', async () => {
    tables = {
      genres: { data: genres, error: null },
      transactions: { data: [row({ id: 'p', amount_yen: -3000 })], error: null },
      transaction_splits: {
        data: [{ transaction_id: 'p', genre_id: 'cafe', amount_yen: -1000 }],
        error: null,
      },
    };
    const { transactions } = await loadLedgerTransactions(
      { from: '2026-09-01', to: '2026-09-30' },
      '2026-09-29',
    );
    expect(transactions[0]!.splits).toEqual([]);
  });

  it('今日より未来の明細は scheduled、kind=special はそのまま読む', async () => {
    tables = {
      genres: { data: genres, error: null },
      transactions: {
        data: [
          row({
            id: 'g',
            occurred_on: '2026-10-03',
            genre_id: 'event',
            amount_yen: -26540,
            kind: 'special',
          }),
        ],
        error: null,
      },
    };
    const { transactions } = await loadLedgerTransactions(
      { from: '2026-09-01', to: '2026-10-31' },
      '2026-09-29',
    );
    expect(transactions[0]).toMatchObject({ status: 'scheduled', kind: 'special' });
  });

  it('kind 列が本番に無い間(42703)は、通常の明細として読み進める', async () => {
    let calls = 0;
    tables = {
      genres: { data: genres, error: null },
      transactions: () => {
        calls += 1;
        return calls === 1
          ? { data: null, error: { code: '42703', message: 'column kind does not exist' } }
          : { data: [row({ id: 'p', kind: undefined })], error: null };
      },
    };
    const { transactions } = await loadLedgerTransactions(
      { from: '2026-09-01', to: '2026-09-30' },
      '2026-09-29',
    );
    expect(transactions[0]!.kind).toBe('normal');
  });
});

describe('loadGenreSpend(目標の実績、受け入れ基準2)', () => {
  it('未来日は予定に分け、特別費も実績のジャンルに入れる', async () => {
    tables = {
      genres: { data: genres, error: null },
      transactions: {
        data: [
          row({ id: 'a', occurred_on: '2026-09-29', genre_id: 'drug', amount_yen: -2500 }),
          row({
            id: 'g',
            occurred_on: '2026-10-03',
            genre_id: 'event',
            amount_yen: -26540,
            kind: 'special',
          }),
          row({
            id: 's',
            occurred_on: '2026-09-29',
            genre_id: 'event',
            amount_yen: -9000,
            kind: 'special',
          }),
        ],
        error: null,
      },
    };
    const result = await loadGenreSpend(
      '2026-09-29',
      '2026-10-06',
      new Date('2026-09-29T03:00:00Z'),
    );
    expect(result.byGenre.get('drug')).toBe(2500);
    expect(result.byGenre.get('event')).toBe(9000);
    expect(result.specialYen).toBe(0);
    expect(result.scheduledYen).toBe(26540);
    expect(result.uncategorizedYen).toBe(0);
  });
});
