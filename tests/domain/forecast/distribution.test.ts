import { describe, expect, it } from 'vitest';

import { forecastDistribution, histogram, probabilityAt } from '@/domain/forecast/distribution';
import { buildForecast } from '@/domain/forecast/engine';
import { eachDay } from '@/domain/period';

describe('同じ試行の確率分布', () => {
  it('返金が支出を上回る終了済み期間でも、着地・分布・確率が同じ純支出になる', () => {
    const forecast = buildForecast({
      period: { from: '2026-10-01', to: '2026-10-17' },
      today: '2026-10-18',
      trainingFrom: '2026-10-01',
      recordStart: '2026-10-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: 0,
      payday: null,
      dataVersion: 'refund',
      trials: 100,
      transactions: [
        {
          occurredOn: '2026-10-10',
          amountYen: 1000,
          genreId: null,
          genreName: null,
          status: 'actual',
          kind: 'refund',
          isTransfer: false,
          reviewStatus: 'auto_ok',
          needsInput: false,
          merchantName: null,
          description: '返金',
        },
      ],
    });
    expect(forecast.actualYen).toBe(-1000);
    expect(forecast.total).toEqual({ p10: -1000, p50: -1000, p70: -1000, p90: -1000, mean: -1000 });
    expect(forecast.totalQuantiles.every((yen) => yen === -1000)).toBe(true);
    expect(probabilityAt(forecast.distribution, -1000)).toBe(1);
    expect(probabilityAt(forecast.distribution, -1001)).toBe(0);
    expect(forecast.probWithinBudget).toBe(1);
  });
  it('左に同額が集中し右に長い裾がある分布を、正規分布で置き換えない', () => {
    const distribution = forecastDistribution([159000, 159000, 159000, 255000, 900000], null);
    expect(probabilityAt(distribution, 155000)).toBe(0);
    expect(probabilityAt(distribution, 189000)).toBe(0.6);
    expect(probabilityAt(distribution, 255000)).toBe(0.8);
    expect(probabilityAt(distribution, 900000)).toBe(1);
  });

  it('PITに0があっても、実績・確定支出より少ない金額の確率は復活しない', () => {
    const distribution = forecastDistribution([200000, 210000, 250000], {
      pit: [0, 0, 0.2, 0.6, 0.9],
      pitWeight: 0.7,
    });
    expect(probabilityAt(distribution, 199999)).toBe(0);
    expect(probabilityAt(distribution, 250000)).toBe(1);
    const probs = Array.from({ length: 101 }, (_, i) => probabilityAt(distribution, i * 3000));
    expect(probs.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= probs[i - 1]!))).toBe(true);
  });

  it('円未満を持つ試行でも、整数円の金額以下を正確に数える', () => {
    const distribution = forecastDistribution([100.01, 100.99, 101, 101.01], null);
    expect(distribution.amounts).toEqual([101, 101, 101, 102]);
    expect(probabilityAt(distribution, 100)).toBe(0);
    expect(probabilityAt(distribution, 101)).toBe(0.75);
    expect(probabilityAt(JSON.parse(JSON.stringify(distribution)), 101)).toBe(0.75);
  });

  it('分布の全棒の確率は1で、目標以下の面積が見出しの確率になる', () => {
    const distribution = forecastDistribution([0, 0, 0, 10000, 10000, 90000], {
      pit: [0.05, 0.4, 0.8],
      pitWeight: 0.2,
    });
    for (const threshold of [0, 5000, 10000, 90000]) {
      const bins = histogram(distribution, { min: -1, max: 90001, bins: 32, threshold });
      expect(bins.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(1, 12);
      const under = bins.filter((bin) => bin.to <= threshold);
      expect(under.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(
        probabilityAt(distribution, threshold),
        12,
      );
    }
  });

  it('36日間の目標でも見出し・金額選択・区間・日別の終点が一致する', () => {
    const pit = [0, 0, 0.05, 0.3, 0.7, 0.99];
    const forecast = buildForecast({
      period: { from: '2026-10-01', to: '2026-11-05' },
      today: '2026-10-18',
      trainingFrom: '2026-04-01',
      recordStart: '2026-04-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: 189000,
      payday: 25,
      dataVersion: '36-days',
      trials: 2000,
      calibration: {
        centerByPhase: { early: 1.1, mid: 0.9, late: 1 },
        pit,
        pitByPhase: { early: pit, mid: pit, late: pit },
        pitWeight: 0.5,
        months: 6,
        sampleSize: pit.length,
      },
      transactions: eachDay('2026-04-01', '2026-10-18').map((occurredOn) => ({
        occurredOn,
        amountYen: -9000,
        genreId: 'food',
        genreName: '食料品',
        status: 'actual',
        kind: 'normal',
        isTransfer: false,
        reviewStatus: 'auto_ok',
        needsInput: false,
        merchantName: null,
        description: '買い物',
      })),
    });
    expect(forecast.probWithinBudget).toBe(probabilityAt(forecast.distribution, 189000));
    expect(probabilityAt(forecast.distribution, 155000)).toBe(0);
    expect(forecast.total.p10).toBe(forecast.totalQuantiles[1]);
    expect(forecast.total.p50).toBe(forecast.totalQuantiles[9]);
    expect(forecast.total.p90).toBe(forecast.totalQuantiles[17]);
    const end = forecast.path.at(-1)!;
    expect(end.date).toBe('2026-11-05');
    expect(end.p10 + forecast.actualYen).toBe(forecast.total.p10);
    expect(end.p50 + forecast.actualYen).toBe(forecast.total.p50);
    expect(end.p90 + forecast.actualYen).toBe(forecast.total.p90);
    if (forecast.suggestion) expect(forecast.suggestion.probBefore).toBe(forecast.probWithinBudget);
    for (const action of forecast.whatIf) {
      expect(action.options[0]!.probWithinBudget).toBe(forecast.probWithinBudget);
    }
  });
});
