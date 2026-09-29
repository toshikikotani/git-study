import { describe, expect, it, vi } from 'vitest';

import { loadCalendarMonth } from '@/features/spending/store';

/**
 * カレンダーが過去・未来の月へ移ったときに読む明細(loadCalendarMonth)。
 * Supabase には触れず、月の範囲の指定・収支の対象外の除外・品目から決めた
 * 代表ジャンルの反映だけを検証する。
 */

const calls: { gte?: string; lte?: string } = {};

const rows = [
  {
    id: 't1',
    occurred_on: '2026-10-20',
    description: 'ラーメン',
    merchant_name: '一蘭',
    amount_yen: -900,
    genre_id: 'g1',
    is_transfer: false,
    review_status: 'auto_ok',
    account_id: 'a1',
    payment_method: 'one_time',
  },
  {
    id: 't2',
    occurred_on: '2026-10-19',
    description: '口座間の移動',
    merchant_name: null,
    amount_yen: -50000,
    genre_id: null,
    is_transfer: true,
    review_status: 'auto_ok',
    account_id: 'a1',
    payment_method: 'one_time',
  },
  {
    id: 't3',
    occurred_on: '2026-10-18',
    description: 'コンビニ',
    merchant_name: null,
    amount_yen: -300,
    genre_id: null,
    is_transfer: false,
    review_status: 'auto_ok',
    account_id: 'a1',
    payment_method: 'one_time',
  },
  {
    id: 't4',
    occurred_on: '2026-10-17',
    description: '対象外の明細',
    merchant_name: null,
    amount_yen: -100,
    genre_id: null,
    is_transfer: false,
    review_status: 'ignored',
    account_id: 'a1',
    payment_method: 'one_time',
  },
];

/** from().select().gte().lte().order() のような呼び出しの連なりを受け、最後に結果を返す。 */
function chain(result: { data: unknown; error: null }, onCall?: (m: string, a: unknown[]) => void) {
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return (...args: unknown[]) => {
        onCall?.(String(prop), args);
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'genres') {
        return chain({
          data: [
            { id: 'g1', name: '外食', budget_yen: 1000 },
            { id: 'g2', name: '食料品', budget_yen: null },
          ],
          error: null,
        });
      }
      if (table === 'transaction_splits') return chain({ data: [], error: null });
      return chain({ data: rows, error: null }, (method, args) => {
        if (method === 'gte') calls.gte = args[1] as string;
        if (method === 'lte') calls.lte = args[1] as string;
      });
    },
  }),
}));

// t3 は品目がすべて「食料品」に分類済み(明細本体のジャンルは空)
vi.mock('@/features/genre/item-genres', () => ({
  resolveItemGenres: async () => new Map([['t3', 'g2']]),
}));

// 基準日(JST 2026-11-15)。10月の明細はすべて過去の実績になる。
const NOW = new Date('2026-11-15T03:00:00Z');

describe('loadCalendarMonth', () => {
  it('指定した月の1日から月末までを読む', async () => {
    await loadCalendarMonth('2026-10-01', NOW);
    expect(calls).toEqual({ gte: '2026-10-01', lte: '2026-10-31' });
  });

  it('12月でも月末(12/31)までを読む', async () => {
    await loadCalendarMonth('2026-12-01', NOW);
    expect(calls.lte).toBe('2026-12-31');
  });

  it('振替・対象外は除き、店名が無ければ摘要を使う', async () => {
    const { transactions: result } = await loadCalendarMonth('2026-10-01', NOW);
    expect(result.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(result.map((t) => t.label)).toEqual(['一蘭', 'コンビニ']);
  });

  it('明細本体のジャンルが空でも、品目から決めた代表ジャンルを使う', async () => {
    const { transactions: result } = await loadCalendarMonth('2026-10-01', NOW);
    expect(result.find((t) => t.id === 't1')).toMatchObject({ genreId: 'g1', genreName: '外食' });
    expect(result.find((t) => t.id === 't3')).toMatchObject({ genreId: 'g2', genreName: '食料品' });
  });

  it('ジャンル別の内訳もその月のものを、金額の大きい順・予算つきで返す', async () => {
    const { genreBreakdown } = await loadCalendarMonth('2026-10-01', NOW);
    expect(genreBreakdown.map((r) => [r.genreName, r.spentYen, r.budgetYen])).toEqual([
      ['外食', 900, 1000],
      ['食料品', 300, null],
    ]);
    // 予算の9割を使っているジャンルは attention、予算が無ければ normal
    expect(genreBreakdown.map((r) => r.tone)).toEqual(['attention', 'normal']);
  });

  it('振替・対象外は内訳に含めない', async () => {
    const { genreBreakdown } = await loadCalendarMonth('2026-10-01', NOW);
    expect(genreBreakdown.reduce((acc, r) => acc + r.spentYen, 0)).toBe(1200);
  });

  it('その月の支出・収入の合計を返す(振替・対象外は含めない)', async () => {
    const { totals } = await loadCalendarMonth('2026-10-01', NOW);
    expect(totals).toMatchObject({ spentYen: 1200, incomeYen: 0, scheduledYen: 0 });
  });

  it('基準日より未来の明細は実績に入れず、予定(scheduledYen)に分ける', async () => {
    const { totals, genreBreakdown } = await loadCalendarMonth(
      '2026-10-01',
      new Date('2026-10-18T03:00:00Z'),
    );
    // 10/19 の振替を除くと、10/20 の一蘭(900円)は未来 = 予定。10/18 のコンビニ(300円)だけが実績。
    expect(totals).toMatchObject({ spentYen: 300, scheduledYen: 900 });
    expect(genreBreakdown.map((r) => [r.genreName, r.spentYen])).toEqual([['食料品', 300]]);
  });
});
