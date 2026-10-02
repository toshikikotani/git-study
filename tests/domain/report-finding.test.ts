import { describe, expect, it } from 'vitest';

import { biggestIncrease } from '@/domain/report-finding';

describe('支出レポートの結論', () => {
  it('直近2ヶ月で一番増えたジャンルと、抑えると残る額', () => {
    const finding = biggestIncrease({
      monthKeys: ['2026-08', '2026-09'],
      categories: [
        { id: 'food', name: '食料品' },
        { id: 'eat', name: '外食' },
      ],
      rows: [
        { monthKey: '2026-08', categoryId: 'eat', spentYen: 18000 },
        { monthKey: '2026-09', categoryId: 'eat', spentYen: 24000 },
        { monthKey: '2026-08', categoryId: 'food', spentYen: 10000 },
        { monthKey: '2026-09', categoryId: 'food', spentYen: 11000 },
      ],
    });
    expect(finding?.genreName).toBe('外食');
    expect(finding?.saveYen).toBe(6000);
  });
});
