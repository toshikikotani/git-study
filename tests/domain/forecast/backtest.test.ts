import { describe, expect, it } from 'vitest';

import {
  actualTotalForPeriod,
  calibrateFromBacktest,
  checkpointsFor,
  crpsSorted,
  empiricalCrps,
  knownTransactionsAt,
  runBacktest,
  shiftRemaining,
  type BacktestPoint,
} from '@/domain/forecast/backtest';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { calibratedProbability, rawLevelFor } from '@/domain/forecast/pit';
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

describe('checkpointsFor(検証の時点)', () => {
  it('2日おきに、最終日の前まで。序盤・中盤・終盤に分ける', () => {
    const points = checkpointsFor({ from: '2026-06-01', to: '2026-06-30' });
    expect(points[0]).toEqual({ asOf: '2026-06-02', phase: 'early' });
    expect(points.at(-1)!.asOf).toBe('2026-06-28');
    expect(points).toHaveLength(14);
    expect(new Set(points.map((p) => p.phase))).toEqual(new Set(['early', 'mid', 'late']));
  });
});

describe('knownTransactionsAt(その時点で知り得た明細)', () => {
  const late = tx({ occurredOn: '2026-06-03', createdOn: '2026-06-10', amountYen: -500 });
  const backfill = tx({ occurredOn: '2026-03-01', createdOn: '2026-06-10', amountYen: -500 });
  const planned = tx({ occurredOn: '2026-06-25', createdOn: '2026-06-01', amountYen: -9000 });

  it('記録した日より前の時点からは見えない(入力の遅れ)', () => {
    expect(knownTransactionsAt([late], '2026-06-05')).toHaveLength(0);
    expect(knownTransactionsAt([late], '2026-06-10')).toHaveLength(1);
  });

  it('45日より遅い記録は、あとからまとめて入れた過去の記録として、使った日で判断する', () => {
    expect(knownTransactionsAt([backfill], '2026-04-01')).toHaveLength(1);
  });

  it('先の日付で入れた予定は、その時点から見て予定になる', () => {
    const [known] = knownTransactionsAt([planned], '2026-06-05');
    expect(known!.status).toBe('scheduled');
  });
});

describe('actualTotalForPeriod(検証の正解)', () => {
  it('特別費を含み、返金を差し引き、振替は数えない', () => {
    const period = { from: '2026-06-01', to: '2026-06-30' };
    const total = actualTotalForPeriod(
      [
        tx({ occurredOn: '2026-06-02', amountYen: -1000 }),
        tx({ occurredOn: '2026-06-03', amountYen: -5000, kind: 'special' }),
        tx({ occurredOn: '2026-06-04', amountYen: 300, kind: 'refund' }),
        tx({ occurredOn: '2026-06-05', amountYen: -9999, isTransfer: true }),
        tx({ occurredOn: '2026-07-01', amountYen: -1000 }),
      ],
      period,
    );
    expect(total).toBe(5700);
  });
});

describe('CRPS', () => {
  it('全試行が実際の値と一致するなら0', () => {
    expect(empiricalCrps(new Float64Array(200).fill(1000), 1000)).toBeCloseTo(0, 5);
  });

  it('離れているほど大きい。並べ替え済みの計算と一致する', () => {
    const samples = Float64Array.from([1, 2, 3, 4, 10]);
    expect(empiricalCrps(samples, 3)).toBeCloseTo(crpsSorted(samples, 3), 10);
    expect(empiricalCrps(samples, 3)).toBeLessThan(empiricalCrps(samples, 30));
  });
});

describe('runBacktest', () => {
  it('毎日ちょうど1,000円使う定常データなら、着地はほぼ当たる', () => {
    const transactions = eachDay('2026-01-01', '2026-08-31').map((d) =>
      tx({ occurredOn: d, amountYen: -1000 }),
    );
    const summary = runBacktest({
      transactions,
      periods: [
        { from: '2026-07-01', to: '2026-07-31' },
        { from: '2026-08-01', to: '2026-08-31' },
      ],
      trainingWindowDays: 150,
      recordStart: '2026-01-01',
      trials: 400,
    });
    expect(summary.points.length).toBe(30);
    expect(summary.medianAbsErrorRatio).toBeLessThan(0.15);
    for (const p of summary.points) expect(p.samples.length).toBeGreaterThan(0);
  });

  it('明細が無くても破綻しない', () => {
    const summary = runBacktest({
      transactions: [],
      periods: [{ from: '2026-06-01', to: '2026-06-30' }],
      trainingWindowDays: 150,
      recordStart: null,
      trials: 200,
    });
    expect(Number.isFinite(summary.hitRate80)).toBe(true);
  });
});

describe('calibrateFromBacktest(時点帯ごとの中心と PIT)', () => {
  /** 試行は 0〜(2×中央) の一様。knownYen=0。 */
  function point(
    phase: BacktestPoint['phase'],
    actualTotal: number,
    median: number,
  ): BacktestPoint {
    const samples = Float64Array.from({ length: 101 }, (_, i) => (2 * median * i) / 100);
    return {
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
      asOf: '2026-06-10',
      phase,
      actualTotal,
      knownYen: 0,
      samples,
      p10: samples[10]!,
      p50: median,
      p90: samples[90]!,
      hitWithin80: true,
      crps: 0,
    };
  }

  it('点が少なければ補正しない(null)', () => {
    expect(calibrateFromBacktest([point('early', 100, 100)], 3)).toBeNull();
  });

  it('序盤だけ実際が多いなら、序盤の中心だけ上げる', () => {
    const points = [
      ...Array.from({ length: 6 }, () => point('early', 130, 100)),
      ...Array.from({ length: 6 }, () => point('late', 100, 100)),
    ];
    const cal = calibrateFromBacktest(points, 6)!;
    expect(cal.centerByPhase.early).toBeGreaterThan(1.05);
    expect(cal.centerByPhase.late).toBeCloseTo(1, 5);
    expect(cal.pitWeight).toBeCloseTo(6 / 12, 5);
    expect(cal.pit).toHaveLength(12);
  });

  it('中心の係数は 0.75〜1.4 に収まる', () => {
    const high = Array.from({ length: 12 }, () => point('mid', 1000, 100));
    expect(calibrateFromBacktest(high, 100)!.centerByPhase.mid).toBeLessThanOrEqual(1.4);
  });

  it('決まっている額は動かさず、残りの部分だけに掛ける', () => {
    expect(shiftRemaining(100000, 50000, 1.2)).toBe(110000);
  });
});

describe('PIT による確率の補正', () => {
  it('補正が無ければ、確率も分位もそのまま', () => {
    expect(calibratedProbability(null, 0.3)).toBe(0.3);
    expect(rawLevelFor(null, 0.9)).toBe(0.9);
  });

  it('過去に実際が分布の外側(0や1の近く)ばかりなら、幅を外側へ広げる', () => {
    const pit = [
      ...Array.from({ length: 10 }, () => 0.01),
      ...Array.from({ length: 10 }, () => 0.99),
    ];
    const cal = { pit, pitWeight: 0.5 };
    expect(rawLevelFor(cal, 0.9)).toBeGreaterThan(0.9);
    expect(rawLevelFor(cal, 0.1)).toBeLessThan(0.1);
    // 確率と分位は互いに逆の関係。
    expect(calibratedProbability(cal, rawLevelFor(cal, 0.7))).toBeGreaterThanOrEqual(0.7 - 1e-6);
  });
});
