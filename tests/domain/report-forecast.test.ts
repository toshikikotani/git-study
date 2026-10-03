import { describe, expect, it } from 'vitest';

import { forecastReport } from '@/domain/report-forecast';

describe('支出予想 v2', () => {
  it('完了月4未満の回帰は出さず、ゼロが多いジャンルは発生割合で予測する', () => {
    const forecast = forecastReport({
      monthKeys: ['2026-07', '2026-08', '2026-09', '2026-10'],
      currentMonthKey: '2026-10',
      categories: [{ id: 'fun', name: '娯楽' }],
      rows: [
        { monthKey: '2026-07', categoryId: 'fun', spentYen: 0 },
        { monthKey: '2026-08', categoryId: 'fun', spentYen: 0 },
        { monthKey: '2026-09', categoryId: 'fun', spentYen: 40000 },
      ],
    });
    expect(forecast.genres[0]?.intermittent).toBe(true);
    expect(forecast.genres[0]?.showBand).toBe(false);
    expect(forecast.genres[0]?.pointYen).toBeGreaterThan(0);
    expect(forecast.genres[0]?.pointYen).toBeLessThan(40000);
  });

  it('予定は学習に入れず点予測へ足す', () => {
    const forecast = forecastReport({
      monthKeys: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      currentMonthKey: '2026-10',
      categories: [{ id: 'food', name: '食料品' }],
      rows: [
        { monthKey: '2026-06', categoryId: 'food', spentYen: 10000 },
        { monthKey: '2026-07', categoryId: 'food', spentYen: 11000 },
        { monthKey: '2026-08', categoryId: 'food', spentYen: 9000 },
        { monthKey: '2026-09', categoryId: 'food', spentYen: 10000 },
      ],
      scheduledByGenre: { food: 2000 },
    });
    expect(forecast.genres[0]?.scheduledYen).toBe(2000);
    expect(forecast.genres[0]?.pointYen).toBeGreaterThanOrEqual(2000);
  });
});
