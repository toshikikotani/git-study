import { describe, expect, it } from 'vitest';

import type { Forecast, ForecastCategoryBand } from '@/domain/forecast/types';
import { genreForecastsFrom, landingReport } from '@/domain/plan-forecast';

const cat = (over: Partial<ForecastCategoryBand> = {}): ForecastCategoryBand => ({
  categoryId: 'g1',
  categoryName: '外食',
  p10: 0,
  p50: 0,
  p90: 0,
  landing: { p10: 16000, p50: 19000, p70: 21000, p90: 25000 },
  baseYen: 11000,
  actualYen: 8000,
  scheduledYen: 3000,
  fixedYen: 0,
  targetYen: 20000,
  exceedance: 0.1,
  meanYen: 0,
  expectedCount: 0,
  type: 'steady',
  ...over,
});

const forecast = (c: ForecastCategoryBand, over: Partial<Forecast> = {}): Forecast => ({
  periodId: 'p',
  asOf: '2026-10-10',
  remainingDays: 10,
  total: { p10: 0, p50: 0, p70: 0, p90: 0, mean: 0 },
  byCategory: [c],
  committed: { scheduledYen: 0, fixedYen: 0 },
  actualYen: 0,
  visits: { expectedYen: 0, merchants: [] },
  pace: { remainingYen: 0, perDayYen: null, recentPerDayYen: null },
  seasonal: { active: false, periodFactor: null },
  special: { expected: 0, p90: 0 },
  probWithinBudget: null,
  expectedOvershoot: 0,
  drivers: [],
  safeDailyAllowance: null,
  status: 'ready',
  dataDays: 60,
  path: [],
  typicalProfile: [],
  bills: { expectedYen: 0, items: [] },
  unrecordedYen: 0,
  phase: 'mid',
  provisional: false,
  balance: null,
  calibration: null,
  totalQuantiles: [],
  suggestion: null,
  whatIf: [],
  breakdown: {
    actualYen: 0,
    committedYen: 0,
    visitsYen: 0,
    billsYen: 0,
    unrecordedYen: 0,
    specialYen: 0,
    variableYen: 0,
    totalYen: 0,
    variableByCategory: [],
  },
  ...over,
});

const genre = { genreId: 'g1', targetYen: 20000, scheduledYen: 3000 };

describe('genreForecastsFrom(確率エンジンの結果から判定)', () => {
  it('超える確率が低ければ「届きそう」、中くらいなら「ぎりぎり」、高ければ「超える」', () => {
    const verdict = (exceedance: number) =>
      genreForecastsFrom({
        forecast: forecast(cat({ exceedance })),
        genres: [genre],
        remainingDays: 10,
      })[0]!.verdict;
    expect(verdict(0.1)).toBe('on_track');
    expect(verdict(0.35)).toBe('tight');
    expect(verdict(0.7)).toBe('over');
  });

  it('使った額と予定だけで目標を超えているなら「届かない」', () => {
    const [g] = genreForecastsFrom({
      forecast: forecast(cat({ baseYen: 21000, exceedance: 1 })),
      genres: [genre],
      remainingDays: 10,
    });
    expect(g!.verdict).toBe('unreachable');
    expect(g!.dailyCapYen).toBeNull();
  });

  it('着地は100円単位。70%で収まる額を「抑えてほしい額」の元にする', () => {
    const [g] = genreForecastsFrom({
      forecast: forecast(cat()),
      genres: [genre],
      remainingDays: 10,
    });
    expect(g).toMatchObject({
      medianYen: 19000,
      lowYen: 16000,
      highYen: 25000,
      recommendedYen: 21000,
    });
    expect(g!.dailyCapYen).toBe(900);
  });

  it('記録が7日未満で予定も無ければ、判断しない', () => {
    const [g] = genreForecastsFrom({
      forecast: forecast(cat(), { dataDays: 3 }),
      genres: [{ ...genre, scheduledYen: 0 }],
      remainingDays: 10,
    });
    expect(g!.verdict).toBe('unknown');
    expect(g!.recommendedYen).toBeNull();
  });

  it('予定があれば、記録が短くても判断する', () => {
    const [g] = genreForecastsFrom({
      forecast: forecast(cat(), { dataDays: 3 }),
      genres: [genre],
      remainingDays: 10,
    });
    expect(g!.verdict).not.toBe('unknown');
  });
});

describe('landingReport', () => {
  const row = {
    genreId: 'g1',
    genreName: '外食',
    targetYen: 20000,
    spentYen: 8000,
    scheduledYen: 3000,
    priorMonthYen: 18000,
    previousMonthYen: 21000,
  };
  const forecasts = genreForecastsFrom({
    forecast: forecast(cat()),
    genres: [genre],
    remainingDays: 10,
  });

  it('ジャンルごとの説明に、使った額と予定を目標の期間の数字で書く', () => {
    const report = landingReport({ remainingDays: 10, rows: [row], forecasts });
    const detail = report.forecasts[0]!.detail;
    expect(detail).toContain('8,000 円使っている');
    expect(detail).toContain('予定が 3,000 円');
    expect(report.forecasts[0]!.advice).toContain('先々月 18,000 円、先月 21,000 円');
  });

  it('抑えてほしい額の合計は、判断できたジャンルの額を足した値', () => {
    const report = landingReport({ remainingDays: 10, rows: [row], forecasts });
    const own = report.forecasts[0]!.recommendedYen;
    expect(own).not.toBeNull();
    expect(report.proposedTotalYen).toBe(own);
  });

  it('判断できるジャンルが無ければ合計は出さない', () => {
    const unknown = genreForecastsFrom({
      forecast: forecast(cat(), { dataDays: 3 }),
      genres: [{ ...genre, scheduledYen: 0 }],
      remainingDays: 10,
    });
    const report = landingReport({
      remainingDays: 10,
      rows: [{ ...row, scheduledYen: 0 }],
      forecasts: unknown,
    });
    expect(report.proposedTotalYen).toBeNull();
    expect(report.summary).toContain('まだ判断できるジャンルがありません');
  });
});
