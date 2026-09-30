import { describe, expect, it } from 'vitest';

import { buildActionCandidates, simulateActions, topActions } from '@/domain/forecast/actions';
import { decomposeSpending, type ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { fitModel } from '@/domain/forecast/model';
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

function buildFitted(today = '2026-10-15') {
  const dining = eachDay('2026-04-01', today).map((d) => tx({ occurredOn: d, amountYen: -1500 }));
  const hobby = eachDay('2026-04-01', today)
    .filter((_, i) => i % 3 === 0)
    .map((d) => tx({ occurredOn: d, amountYen: -4000, genreId: 'hobby', genreName: '娯楽' }));
  const transactions = [...dining, ...hobby];
  const decomposed = decomposeSpending({
    transactions,
    period: { from: '2026-10-01', to: '2026-10-31' },
    today,
    trainingFrom: '2026-04-01',
    recordStart: '2026-04-01',
    confirmedFixedKeys: new Set(),
    detectedSubscriptions: [],
  });
  const fitted = fitModel({ variable: decomposed.variable, today, payday: null });
  return { fitted, decomposed };
}

describe('buildActionCandidates(M5)', () => {
  it('上位ドライバーのカテゴリごとに「あと1回減らす」「1日おきにする」の2種類を作る', () => {
    const { fitted } = buildFitted();
    const candidates = buildActionCandidates(
      [
        { categoryId: 'dining', categoryName: '外食', shareOfRisk: 0.7 },
        { categoryId: 'hobby', categoryName: '娯楽', shareOfRisk: 0.3 },
      ],
      fitted.categories,
      2,
    );
    expect(candidates).toHaveLength(4);
    expect(candidates.map((c) => c.kind)).toEqual([
      'reduce_count',
      'every_other_day',
      'reduce_count',
      'every_other_day',
    ]);
    expect(candidates[0]!.description).toContain('外食');
  });

  it('maxCategoriesで対象を絞る', () => {
    const { fitted } = buildFitted();
    const candidates = buildActionCandidates(
      [
        { categoryId: 'dining', categoryName: '外食', shareOfRisk: 0.7 },
        { categoryId: 'hobby', categoryName: '娯楽', shareOfRisk: 0.3 },
      ],
      fitted.categories,
      1,
    );
    expect(candidates).toHaveLength(2);
  });
});

describe('simulateActions(M5、共通乱数法)', () => {
  it('変動費を減らす打ち手で、着地額(p50)は増えない', () => {
    const today = '2026-10-15';
    const { fitted, decomposed } = buildFitted(today);
    const candidates = buildActionCandidates(
      [{ categoryId: 'dining', categoryName: '外食', shareOfRisk: 1 }],
      fitted.categories,
      1,
    );
    const results = simulateActions(
      {
        periodId: 'p_2026-10-01_2026-10-31',
        today,
        periodTo: '2026-10-31',
        fitted,
        committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
        actualYen: decomposed.actualYen,
        specialHistoricalAmounts: decomposed.special.historicalAmounts,
        specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
        remainingDays: 17,
        budgetYen: 100000,
        payday: null,
        dataVersion: 'v1',
        trials: 1000,
      },
      candidates,
    );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.newP50).toBeLessThanOrEqual(r.baselineP50);
      expect(r.totalDelta).toBeLessThanOrEqual(0);
    }
  });

  it('変動費を減らす打ち手で、予算内に収まる確率は下がらない', () => {
    const today = '2026-10-15';
    const { fitted, decomposed } = buildFitted(today);
    const candidates = buildActionCandidates(
      [{ categoryId: 'dining', categoryName: '外食', shareOfRisk: 1 }],
      fitted.categories,
      1,
    );
    const results = simulateActions(
      {
        periodId: 'p_2026-10-01_2026-10-31',
        today,
        periodTo: '2026-10-31',
        fitted,
        committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
        actualYen: decomposed.actualYen,
        specialHistoricalAmounts: decomposed.special.historicalAmounts,
        specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
        remainingDays: 17,
        budgetYen: 80000,
        payday: null,
        dataVersion: 'v1',
        trials: 1000,
      },
      candidates,
    );
    for (const r of results) {
      expect(r.probDelta).not.toBeNull();
      expect(r.probDelta!).toBeGreaterThanOrEqual(0);
    }
  });

  it('同じデータ・同じシードなら結果が完全に一致する(決定論)', () => {
    const today = '2026-10-15';
    const { fitted, decomposed } = buildFitted(today);
    const candidates = buildActionCandidates(
      [{ categoryId: 'dining', categoryName: '外食', shareOfRisk: 1 }],
      fitted.categories,
      1,
    );
    const input = {
      periodId: 'p_2026-10-01_2026-10-31',
      today,
      periodTo: '2026-10-31',
      fitted,
      committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
      actualYen: decomposed.actualYen,
      specialHistoricalAmounts: decomposed.special.historicalAmounts,
      specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
      remainingDays: 17,
      budgetYen: 100000,
      payday: null,
      dataVersion: 'v1',
      trials: 500,
    };
    const a = simulateActions(input, candidates);
    const b = simulateActions(input, candidates);
    expect(a).toEqual(b);
  });
});

describe('topActions', () => {
  it('確率の改善が大きい順に並べ、指定件数までに絞る', () => {
    const results = [
      {
        action: {
          categoryId: 'a',
          categoryName: 'A',
          kind: 'reduce_count' as const,
          description: '',
          rateMultiplier: -1,
        },
        baselineProbWithinBudget: 0.5,
        newProbWithinBudget: 0.6,
        probDelta: 0.1,
        baselineP50: 100,
        newP50: 90,
        totalDelta: -10,
      },
      {
        action: {
          categoryId: 'b',
          categoryName: 'B',
          kind: 'reduce_count' as const,
          description: '',
          rateMultiplier: -1,
        },
        baselineProbWithinBudget: 0.5,
        newProbWithinBudget: 0.8,
        probDelta: 0.3,
        baselineP50: 100,
        newP50: 70,
        totalDelta: -30,
      },
      {
        action: {
          categoryId: 'c',
          categoryName: 'C',
          kind: 'reduce_count' as const,
          description: '',
          rateMultiplier: -1,
        },
        baselineProbWithinBudget: 0.5,
        newProbWithinBudget: 0.55,
        probDelta: 0.05,
        baselineP50: 100,
        newP50: 95,
        totalDelta: -5,
      },
    ];
    const top = topActions(results, 2);
    expect(top.map((r) => r.action.categoryId)).toEqual(['b', 'a']);
  });
});
