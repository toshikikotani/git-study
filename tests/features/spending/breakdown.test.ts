import { describe, expect, it } from 'vitest';

import { buildGenreBreakdown } from '@/features/spending/breakdown';

const genres = [
  { id: 'g1', name: '外食', budget_yen: 10000 },
  { id: 'g2', name: '食料品', budget_yen: null },
  { id: 'g3', name: '旅行', budget_yen: 5000 },
];

function tx(
  overrides: Partial<{
    categoryId: string | null;
    amountYen: number;
    occurredOn: string;
    isTransfer: boolean;
    reviewStatus: 'auto_ok' | 'ignored';
  }>,
) {
  return {
    categoryId: 'g1',
    amountYen: -1000,
    occurredOn: '2026-08-10',
    isTransfer: false,
    reviewStatus: 'auto_ok' as const,
    ...overrides,
  };
}

describe('buildGenreBreakdown', () => {
  it('指定した月の支出だけをジャンルごとに集め、金額の大きい順に並べる', () => {
    const result = buildGenreBreakdown(
      genres,
      [
        tx({ categoryId: 'g2', amountYen: -3000 }),
        tx({ categoryId: 'g1', amountYen: -1000 }),
        tx({ categoryId: 'g1', amountYen: -500 }),
        tx({ categoryId: 'g1', amountYen: -99999, occurredOn: '2026-07-31' }),
      ],
      '2026-08',
    );
    expect(result.map((r) => [r.genreName, r.spentYen])).toEqual([
      ['食料品', 3000],
      ['外食', 1500],
    ]);
  });

  it('支出の無いジャンルは出さない', () => {
    const result = buildGenreBreakdown(genres, [tx({ categoryId: 'g1' })], '2026-08');
    expect(result.map((r) => r.genreName)).toEqual(['外食']);
  });

  it('未分類の支出は「未分類」として1行足す(月の絞り込みも効く)', () => {
    const result = buildGenreBreakdown(
      genres,
      [
        tx({ categoryId: null, amountYen: -700 }),
        tx({ categoryId: null, amountYen: -800, occurredOn: '2026-09-01' }),
      ],
      '2026-08',
    );
    expect(result).toEqual([
      { genreId: null, genreName: '未分類', spentYen: 700, budgetYen: null, tone: 'normal' },
    ]);
  });

  it('収入・振替・対象外は含めない', () => {
    const result = buildGenreBreakdown(
      genres,
      [tx({ amountYen: 5000 }), tx({ isTransfer: true }), tx({ reviewStatus: 'ignored' })],
      '2026-08',
    );
    expect(result).toEqual([]);
  });

  it('予算を超えたら over、7割以上なら attention', () => {
    const result = buildGenreBreakdown(
      genres,
      [tx({ categoryId: 'g1', amountYen: -12000 }), tx({ categoryId: 'g3', amountYen: -3600 })],
      '2026-08',
    );
    expect(result.map((r) => [r.genreName, r.tone])).toEqual([
      ['外食', 'over'],
      ['旅行', 'attention'],
    ]);
  });
});
