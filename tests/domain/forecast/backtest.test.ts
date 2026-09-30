import { describe, expect, it } from 'vitest';

import {
  applyWidthFactor,
  backtestCheckpoints,
  calibrateWidth,
  empiricalCrps,
  runBacktest,
  selectModel,
  type BacktestPoint,
} from '@/domain/forecast/backtest';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { eachDay } from '@/domain/period';

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'dining',
    genreName: '外食',
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: 'x',
    ...o,
  };
}

describe('backtestCheckpoints', () => {
  it('1日目・3日目・半分・残り2日に対応する経過割合を返す(30日期間)', () => {
    const fractions = backtestCheckpoints(30);
    expect(fractions.length).toBeGreaterThanOrEqual(3);
    expect(fractions[0]!).toBeCloseTo(1 / 30, 2);
    expect(fractions).toContain(0.5);
    expect(fractions[fractions.length - 1]!).toBeCloseTo(28 / 30, 2);
  });
});

describe('empiricalCrps', () => {
  it('全試行が実際の値と一致するなら0(完璧な予測)', () => {
    const samples = new Float64Array(200).fill(1000);
    expect(empiricalCrps(samples, 1000)).toBeCloseTo(0, 5);
  });

  it('試行が実際の値から離れているほど大きくなる', () => {
    const near = new Float64Array(200).fill(1000);
    const far = new Float64Array(200).fill(1000);
    expect(empiricalCrps(near, 1100)).toBeLessThan(empiricalCrps(far, 5000));
  });
});

describe('runBacktest(M4)', () => {
  it('毎日ちょうど1,000円使う定常データなら、実際の着地は80%の幅に収まりやすい', () => {
    // 半年分の定常データを2期間ぶん用意する
    const transactions = eachDay('2026-01-01', '2026-08-31').map((d) =>
      tx({ occurredOn: d, amountYen: -1000 }),
    );
    const periods = [
      { from: '2026-06-01', to: '2026-06-30' },
      { from: '2026-07-01', to: '2026-07-31' },
      { from: '2026-08-01', to: '2026-08-31' },
    ];
    const summary = runBacktest({
      transactions,
      periods,
      trainingWindowDays: 150,
      recordStart: '2026-01-01',
      bootstrapWeight: 0,
      trials: 1000,
    });
    expect(summary.points.length).toBeGreaterThan(0);
    expect(summary.hitRate80).toBeGreaterThan(0.5);
    expect(summary.medianAbsErrorRatio).toBeLessThan(0.3);
  });

  it('明細が無ければ空の結果になる(破綻しない)', () => {
    const summary = runBacktest({
      transactions: [],
      periods: [{ from: '2026-06-01', to: '2026-06-30' }],
      trainingWindowDays: 150,
      recordStart: null,
      bootstrapWeight: 0,
      trials: 500,
    });
    expect(summary.points.length).toBeGreaterThan(0);
    expect(Number.isFinite(summary.hitRate80)).toBe(true);
  });
});

describe('calibrateWidth(コンフォーマル補正)', () => {
  function point(actualTotal: number, p10: number, p50: number, p90: number): BacktestPoint {
    return {
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
      asOf: '2026-06-15',
      actualTotal,
      p10,
      p50,
      p90,
      hitWithin80: actualTotal >= p10 && actualTotal <= p90,
      crps: 0,
    };
  }

  it('点数が少なければ補正しない(widthFactor=1)', () => {
    const result = calibrateWidth([point(1000, 900, 1000, 1100)]);
    expect(result.widthFactor).toBe(1);
  });

  it('実際の値が帯の外に出やすい(狭すぎる)なら、widthFactorは1より大きくなる', () => {
    const points = Array.from({ length: 10 }, (_, i) => point(1500 + i, 900, 1000, 1100));
    const result = calibrateWidth(points);
    expect(result.widthFactor).toBeGreaterThan(1);
  });

  it('実際の値がいつも帯の中心近くに収まる(広すぎる)なら、widthFactorは1より小さくなる', () => {
    const points = Array.from({ length: 10 }, (_, i) => point(995 + i, 500, 1000, 1500));
    const result = calibrateWidth(points);
    expect(result.widthFactor).toBeLessThan(1);
  });
});

describe('applyWidthFactor', () => {
  it('中央値はそのまま、片側ずつ帯を伸縮する', () => {
    const result = applyWidthFactor({ p10: 800, p50: 1000, p90: 1300 }, 2);
    expect(result.p50).toBe(1000);
    expect(result.p10).toBe(600); // 1000-(1000-800)*2
    expect(result.p90).toBe(1600); // 1000+(1300-1000)*2
  });
});

describe('selectModel(M4)', () => {
  it('検証に足るバックテストの点数が無ければベイズモデルにフォールバックする', () => {
    const transactions = eachDay('2026-06-01', '2026-06-20').map((d) =>
      tx({ occurredOn: d, amountYen: -1000 }),
    );
    const selection = selectModel({
      transactions,
      periods: [{ from: '2026-06-01', to: '2026-06-30' }],
      trainingWindowDays: 60,
      recordStart: '2026-06-01',
      trials: 500,
    });
    expect(selection.method).toBe('bayes');
    expect(selection.bootstrapWeight).toBe(0);
  });
});
