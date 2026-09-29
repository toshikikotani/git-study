import { describe, expect, it, vi } from 'vitest';

import { loadCalendarMonth } from '@/features/spending/store';

/**
 * カレンダーが過去・未来の月へ移ったときに読む明細(loadCalendarMonth)。
 * Supabase には触れず、月の範囲の指定・収支の対象外の除外・品目から決めた
 * 代表ジャンルの反映だけを検証する。
 */

const calls: { gte?: string; lt?: string } = {};

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

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'genres') {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: 'g1', name: '外食', budget_yen: 1000 },
                  { id: 'g2', name: '食料品', budget_yen: null },
                ],
                error: null,
              }),
          }),
        };
      }
      return {
        select: () => ({
          gte: (_column: string, value: string) => {
            calls.gte = value;
            return {
              lt: (_c: string, upper: string) => {
                calls.lt = upper;
                return { order: () => Promise.resolve({ data: rows, error: null }) };
              },
            };
          },
        }),
      };
    },
  }),
}));

// t3 は品目がすべて「食料品」に分類済み(明細本体のジャンルは空)
vi.mock('@/features/genre/item-genres', () => ({
  resolveItemGenres: async () => new Map([['t3', 'g2']]),
}));

describe('loadCalendarMonth', () => {
  it('指定した月の1日から翌月1日の手前までを読む', async () => {
    await loadCalendarMonth('2026-10-01');
    expect(calls).toEqual({ gte: '2026-10-01', lt: '2026-11-01' });
  });

  it('年をまたぐ月末でも翌月の1日までを読む', async () => {
    await loadCalendarMonth('2026-12-01');
    expect(calls.lt).toBe('2027-01-01');
  });

  it('振替・対象外は除き、店名が無ければ摘要を使う', async () => {
    const { transactions: result } = await loadCalendarMonth('2026-10-01');
    expect(result.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(result.map((t) => t.label)).toEqual(['一蘭', 'コンビニ']);
  });

  it('明細本体のジャンルが空でも、品目から決めた代表ジャンルを使う', async () => {
    const { transactions: result } = await loadCalendarMonth('2026-10-01');
    expect(result.find((t) => t.id === 't1')).toMatchObject({ genreId: 'g1', genreName: '外食' });
    expect(result.find((t) => t.id === 't3')).toMatchObject({ genreId: 'g2', genreName: '食料品' });
  });

  it('ジャンル別の内訳もその月のものを、金額の大きい順・予算つきで返す', async () => {
    const { genreBreakdown } = await loadCalendarMonth('2026-10-01');
    expect(genreBreakdown.map((r) => [r.genreName, r.spentYen, r.budgetYen])).toEqual([
      ['外食', 900, 1000],
      ['食料品', 300, null],
    ]);
    // 予算の9割を使っているジャンルは attention、予算が無ければ normal
    expect(genreBreakdown.map((r) => r.tone)).toEqual(['attention', 'normal']);
  });

  it('振替・対象外は内訳に含めない', async () => {
    const { genreBreakdown } = await loadCalendarMonth('2026-10-01');
    expect(genreBreakdown.reduce((acc, r) => acc + r.spentYen, 0)).toBe(1200);
  });

  it('その月の支出・収入の合計を返す(振替・対象外は含めない)', async () => {
    const { totals } = await loadCalendarMonth('2026-10-01');
    expect(totals).toEqual({ spentYen: 1200, incomeYen: 0 });
  });
});
