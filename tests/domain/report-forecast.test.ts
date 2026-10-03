import { describe, expect, it } from 'vitest';

import { forecastGenre } from '@/domain/report-forecast';

describe('ジャンル支出の統計予測', () => {
  it('完了月の回帰で点予測と80%区間を出す', () => {
    const forecast = forecastGenre({
      monthKeys: ['2026-07', '2026-08', '2026-09', '2026-10'],
      currentMonthKey: '2026-10',
      categories: [{ id: 'eat', name: '外食' }],
      rows: [
        { monthKey: '2026-07', categoryId: 'eat', spentYen: 10000 },
        { monthKey: '2026-08', categoryId: 'eat', spentYen: 12000 },
        { monthKey: '2026-09', categoryId: 'eat', spentYen: 14000 },
      ],
    });
    expect(forecast?.months).toBe(3);
    expect(forecast?.pointYen).toBe(16000);
    expect(forecast?.lowYen).toBeLessThan(forecast!.pointYen);
    expect(forecast?.highYen).toBeGreaterThan(forecast!.pointYen);
    expect(forecast?.zScore).toBeGreaterThan(0);
  });
});
