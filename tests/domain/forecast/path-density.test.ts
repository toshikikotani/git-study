import { describe, expect, it } from 'vitest';

import { forecastDistribution, probabilityAt } from '@/domain/forecast/distribution';
import { buildForecast } from '@/domain/forecast/engine';
import { pathDensity } from '@/domain/forecast/path-density';
import { remainingOfTotal } from '@/domain/forecast/remaining';
import { eachDay } from '@/domain/period';
import type { CategoryLine } from '@/features/category/model';
import { buildCumulative, withoutScheduled } from '@/features/category/pace';

describe('累計予測の金額ごとの密度', () => {
  it('左右に山がある分布を、中央が濃い帯へ置き換えない', () => {
    const amounts = [
      ...Array<number>(40).fill(1000),
      ...Array<number>(20).fill(50000),
      ...Array<number>(40).fill(99000),
    ];
    const bins = pathDensity(forecastDistribution(amounts, null), {
      lowYen: 0,
      highYen: 100000,
      bins: 10,
    });
    const expected = [0.4, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.4];
    for (const [i, bin] of bins.entries()) expect(bin.probability).toBeCloseTo(expected[i]!, 12);
    expect(bins.every((bin) => bin.highYen - bin.lowYen === 10000)).toBe(true);
  });

  it('右に長い裾があるとき、低い金額に集まった試行を濃くする', () => {
    const distribution = forecastDistribution(
      [...Array<number>(70).fill(10000), ...Array.from({ length: 30 }, (_, i) => 20000 + i * 3000)],
      null,
    );
    const bins = pathDensity(distribution, { lowYen: 10000, highYen: 110000, bins: 10 });
    expect(bins[0]!.probability).toBe(0.7);
    expect(bins[0]!.probability).toBeGreaterThan(
      Math.max(...bins.slice(1).map((b) => b.probability)),
    );
    expect(bins.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(1, 12);
  });

  it('整数円の境界と端点にある同額試行を、漏れ・重複なく1回ずつ数える', () => {
    const distribution = forecastDistribution([100.01, 100.99, 101, 101.01, 102.01, 104], null);
    const bins = pathDensity(distribution, { lowYen: 100, highYen: 104, bins: 4 });
    const expected = [0, 0.5, 1 / 6, 1 / 3];
    for (const [i, bin] of bins.entries()) expect(bin.probability).toBeCloseTo(expected[i]!, 12);
    expect(bins.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(1, 12);
  });

  it('帯内の確率は元の補正済みCDFとの差分で、帯内だけで1へ正規化しない', () => {
    const distribution = forecastDistribution(
      Array.from({ length: 101 }, (_, i) => i * 1000),
      { pit: [0, 0.05, 0.3, 0.7, 0.95], pitWeight: 0.6 },
    );
    const bins = pathDensity(distribution, { lowYen: 20000, highYen: 70000, bins: 7 });
    const mass = probabilityAt(distribution, 70000) - probabilityAt(distribution, 19999);
    expect(bins.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(mass, 12);
    expect(mass).toBeLessThan(1);
    for (const [i, bin] of bins.entries()) {
      expect(bin.probability).toBeCloseTo(
        probabilityAt(
          distribution,
          i === bins.length - 1 ? bin.highYen : Math.ceil(bin.highYen) - 1,
        ) - probabilityAt(distribution, Math.ceil(bin.lowYen) - 1),
        12,
      );
    }
    const plain = pathDensity(
      { ...distribution, calibration: null },
      {
        lowYen: 20000,
        highYen: 70000,
        bins: 7,
      },
    );
    expect(bins.map((bin) => bin.probability)).not.toEqual(plain.map((bin) => bin.probability));
  });

  it('全試行が同額なら、幅0・確率1の点で返す', () => {
    expect(
      pathDensity(forecastDistribution([3000, 3000, 3000], null), { lowYen: 3000, highYen: 3000 }),
    ).toEqual([{ lowYen: 3000, highYen: 3000, probability: 1 }]);
  });

  it('p10とp90が同額でも、外側の試行を点の確率へ含めない', () => {
    const distribution = forecastDistribution([100, ...Array<number>(18).fill(500), 900], null);
    const bins = pathDensity(distribution, { lowYen: 500, highYen: 500 });
    expect(bins).toHaveLength(1);
    expect(bins[0]!.probability).toBeCloseTo(0.9, 12);
  });

  it('空の分布・逆向きの範囲・非有限の範囲は描画しない', () => {
    expect(pathDensity(forecastDistribution([], null), { lowYen: 0, highYen: 100 })).toEqual([]);
    const distribution = forecastDistribution([100], null);
    expect(pathDensity(distribution, { lowYen: 101, highYen: 100 })).toEqual([]);
    expect(pathDensity(distribution, { lowYen: 0, highYen: Infinity })).toEqual([]);
  });

  it('1円の幅を細分化せず、負の純支出・小数の端点でも確率を保つ', () => {
    const distribution = forecastDistribution([-2, -1, 0, 1, 2], null);
    const one = pathDensity(distribution, { lowYen: -1, highYen: 0, bins: 16 });
    expect(one).toHaveLength(1);
    expect(one[0]!.probability).toBeCloseTo(0.4, 12);
    const fractional = pathDensity(distribution, { lowYen: -1.5, highYen: 1.5, bins: 2 });
    expect(fractional.reduce((sum, bin) => sum + bin.probability, 0)).toBeCloseTo(0.6, 12);
  });
});

describe('同じ分布から累計グラフまで密度を届ける', () => {
  const forecast = buildForecast({
    period: { from: '2026-10-01', to: '2026-11-05' },
    today: '2026-10-19',
    trainingFrom: '2026-04-01',
    recordStart: '2026-04-01',
    confirmedFixedKeys: new Set(),
    detectedSubscriptions: [],
    budgetYen: 189000,
    payday: 25,
    dataVersion: 'density-cdf',
    trials: 2000,
    calibration: {
      centerByPhase: { early: 1.1, mid: 0.9, late: 1 },
      pit: [0, 0.05, 0.3, 0.7, 0.99],
      pitByPhase: {
        early: [0, 0.05, 0.3, 0.7, 0.99],
        mid: [0, 0.05, 0.3, 0.7, 0.99],
        late: [0, 0.05, 0.3, 0.7, 0.99],
      },
      pitWeight: 0.5,
      months: 5,
      sampleSize: 5,
    },
    transactions: eachDay('2026-04-01', '2026-10-19').map((occurredOn) => ({
      occurredOn,
      amountYen: -1200,
      genreId: 'food',
      genreName: '食料品',
      status: 'actual',
      kind: 'normal',
      isTransfer: false,
      reviewStatus: 'auto_ok',
      needsInput: false,
      merchantName: null,
      description: '食費',
    })),
  });

  it('最終日の密度は、実績を戻すと見出しと同じ着地分布そのものになる', () => {
    const end = forecast.path.at(-1)!;
    const absolute = end.density!.map((bin) => ({
      ...bin,
      lowYen: bin.lowYen + forecast.actualYen,
      highYen: bin.highYen + forecast.actualYen,
    }));
    const expected = pathDensity(forecast.distribution, {
      lowYen: forecast.total.p10,
      highYen: forecast.total.p90,
    });
    expect(absolute).toEqual(expected);
    expect(forecast.probWithinBudget).toBe(probabilityAt(forecast.distribution, 189000));
  });

  it('日ごとの分位の範囲で密度を渡し、累計では実績ぶんだけ平行移動する', () => {
    const remaining = remainingOfTotal(forecast);
    expect(remaining.path!.map((point) => point.density)).toEqual(
      forecast.path.map((point) => point.density),
    );
    const actualLine = {
      occurredOn: '2026-10-19',
      amountYen: -forecast.actualYen,
      status: 'actual',
    } as CategoryLine;
    const chart = buildCumulative({
      lines: [actualLine],
      monthStart: '2026-10-01',
      monthEnd: '2026-11-05',
      today: '2026-10-19',
      recordStart: '2026-10-01',
      goal: null,
      remaining,
    });
    for (const point of forecast.path) {
      expect(point.density![0]!.lowYen).toBe(point.p10);
      expect(point.density!.at(-1)!.highYen).toBe(point.p90);
      const day = chart.days.find((day) => day.date === point.date)!;
      expect(day.forecastDensity).toEqual(
        point.density!.map((bin) => ({
          ...bin,
          lowYen: bin.lowYen + forecast.actualYen,
          highYen: bin.highYen + forecast.actualYen,
        })),
      );
      expect(day.forecastYen).toBe(point.p50 + forecast.actualYen);
    }
    expect(
      chart.days
        .filter((day) => day.date <= forecast.asOf)
        .every((day) => day.forecastDensity === undefined),
    ).toBe(true);
  });

  it('予定を除いた表示でも、区間の金額だけを移動して確率は変えない', () => {
    const remaining = {
      lowYen: 100,
      medianYen: 200,
      highYen: 300,
      path: [
        {
          date: '2026-10-20',
          lowYen: 5100,
          medianYen: 5200,
          highYen: 5300,
          density: [{ lowYen: 5100, highYen: 5300, probability: 0.8 }],
        },
      ],
    };
    const result = withoutScheduled(remaining, [
      { occurredOn: '2026-10-20', amountYen: -5000, status: 'scheduled' } as CategoryLine,
    ]);
    expect(result.path![0]!.density).toEqual([{ lowYen: 100, highYen: 300, probability: 0.8 }]);
    expect(result.path![0]!.lowYen).toBe(100);
    expect(result.path![0]!.highYen).toBe(300);
  });
});
