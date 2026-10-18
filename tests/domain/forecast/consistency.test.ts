import { describe, expect, it } from 'vitest';

import { actualTotalForPeriod } from '@/domain/forecast/backtest';
import { decomposeSpending, type ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecast } from '@/domain/forecast/engine';
import { simulateForecast, type SimulateInput } from '@/domain/forecast/simulate';
import { eachDay } from '@/domain/period';

const tx = (
  value: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction => ({
  genreId: 'food',
  genreName: '食料品',
  status: 'actual',
  kind: 'normal',
  isTransfer: false,
  reviewStatus: 'auto_ok',
  needsInput: false,
  merchantName: null,
  description: '買い物',
  ...value,
});

const base = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  today: '2026-10-02',
  trainingFrom: '2026-09-01',
  recordStart: '2026-09-01',
  confirmedFixedKeys: new Set<string>(),
  detectedSubscriptions: [],
};

describe('確率・区間・分布で同じ試行を使う', () => {
  it('支出ゼロが多く請求の有無で山が分かれる場合も、平均額で分位を持ち上げない', () => {
    const input: SimulateInput = {
      periodId: '2026-10',
      today: '2026-10-30',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      remainingDays: 1,
      fitted: {
        categories: [
          {
            categoryId: 'food',
            categoryName: '食料品',
            countPosterior: { alpha: 1200, beta: 10000 },
            amountPosterior: { mu: Math.log(10000), sigmaSq: 0.05, kappa: 1000000 },
            monthTauSq: 0,
            dayOffAmount: { delta: 0, share: 0 },
            weekdayFactor: Array(7).fill(1),
            payCycleFactor: Array(5).fill(1),
            holidayFactor: 1,
            dataDays: 100,
          },
        ],
        monthFactor: Array(13).fill(1),
        seasonal: false,
        pooledDailyRate: 0.12,
        dataDays: 100,
        outingShock: null,
      },
      payday: null,
      actualYen: 50000,
      specialHistoricalAmounts: [],
      specialOccurrencesPerDay: 0,
      budgetYen: 50000,
      trials: 5000,
      seed: 'zero-and-two-peaks',
      monthLevelK: Infinity,
      billEvents: [
        {
          key: 'bill',
          label: '請求',
          categoryId: 'bill',
          date: '2026-10-31',
          probability: 0.2,
          fixedYen: 50000,
          logMu: Math.log(50000),
          logSigma: 0,
        },
      ],
    };
    const result = simulateForecast(input);

    // 追加の支出がない試行が過半数。残り支出の平均が正でも、中央値は実績のまま。
    expect(result.total.mean).toBeGreaterThan(input.actualYen);
    expect(result.probWithinBudget).toBeGreaterThan(0.65);
    expect(result.total.p10).toBe(input.actualYen);
    expect(result.total.p50).toBe(input.actualYen);
    expect(result.total.p90).toBeGreaterThanOrEqual(input.actualYen + 50000);
    expect(result.total.p10).toBe(result.totalQuantiles[1]);
    expect(result.total.p50).toBe(result.totalQuantiles[9]);
    expect(result.total.p90).toBe(result.totalQuantiles[17]);
    expect(result.path.at(-1)!.p10 + input.actualYen).toBe(result.total.p10);
    expect(result.path.at(-1)!.p50 + input.actualYen).toBe(result.total.p50);
    expect(result.path.at(-1)!.p90 + input.actualYen).toBe(result.total.p90);
  });
});

describe('未分類も全体の支出に含める', () => {
  const transactions = [
    tx({ occurredOn: '2026-10-01', amountYen: -12000 }),
    tx({ occurredOn: '2026-10-01', amountYen: -4000, genreId: null, genreName: null }),
    tx({
      occurredOn: '2026-10-02',
      amountYen: 1000,
      kind: 'refund',
      genreId: null,
      genreName: null,
    }),
    tx({ occurredOn: '2026-10-01', amountYen: 200000, genreId: null, genreName: null }),
    tx({
      occurredOn: '2026-10-20',
      amountYen: -5000,
      status: 'scheduled',
      genreId: null,
      genreName: null,
    }),
    tx({
      occurredOn: '2026-10-01',
      amountYen: -7000,
      reviewStatus: 'ignored',
      genreId: null,
    }),
    tx({ occurredOn: '2026-10-01', amountYen: -3000, isTransfer: true, genreId: null }),
  ];

  it('未分類の支出・返金・予定を数え、収入・振替・対象外は数えない', () => {
    const result = decomposeSpending({ ...base, transactions });
    const actual = actualTotalForPeriod(transactions, {
      from: base.period.from,
      to: base.today,
    });
    expect(actual).toBe(15000);
    expect(result.actualYen).toBe(actual);
    expect(result.committed.scheduledYen).toBe(5000);
    expect(result.baseByCategory.find((category) => category.categoryId === 'none')).toEqual({
      categoryId: 'none',
      categoryName: '未分類',
      actualYen: 3000,
      scheduledYen: 5000,
      fixedYen: 0,
    });
  });

  it('全体予測に含め、カテゴリを指定した予測では指定した支出だけに絞る', () => {
    const input = {
      ...base,
      transactions,
      budgetYen: null,
      payday: null,
      dataVersion: 'uncategorized',
      trials: 1000,
      usePopulationPrior: false,
    };
    const all = buildForecast(input);
    const scoped = buildForecast({ ...input, scope: { genreIds: new Set(['food']) } });
    expect(all.actualYen).toBe(15000);
    expect(all.committed.scheduledYen).toBe(5000);
    expect(all.total.p10).toBeGreaterThanOrEqual(20000);
    expect(scoped.actualYen).toBe(12000);
    expect(scoped.committed.scheduledYen).toBe(0);
    expect(scoped.byCategory.map((category) => category.categoryId)).toEqual(['food']);
  });

  it('未分類の履歴からも学習し、今期の記録を水準の更新に使う', () => {
    const result = decomposeSpending({
      ...base,
      transactions: eachDay('2026-09-01', base.today).map((occurredOn) =>
        tx({ occurredOn, amountYen: -1000, genreId: null, genreName: null }),
      ),
    });
    const training = result.variable.find((category) => category.categoryId === 'none');
    expect(training?.days.reduce((count, day) => count + day.count, 0)).toBe(30);
    expect(
      result.periodObservations.find((category) => category.categoryId === 'none')?.count,
    ).toBe(2);
  });
});
