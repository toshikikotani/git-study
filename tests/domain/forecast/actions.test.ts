import { describe, expect, it } from 'vitest';

import {
  buildActionCandidates,
  keepAsIs,
  simulateActions,
  topActions,
  weeklyReductionCandidates,
  type ActionResult,
} from '@/domain/forecast/actions';
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

const TODAY = '2026-10-15';

function buildFitted(today = TODAY) {
  const dining = eachDay('2026-04-01', today).map((d) => tx({ occurredOn: d, amountYen: -1500 }));
  const hobby = eachDay('2026-04-01', today)
    .filter((_, i) => i % 3 === 0)
    .map((d) => tx({ occurredOn: d, amountYen: -4000, genreId: 'hobby', genreName: '娯楽' }));
  const decomposed = decomposeSpending({
    transactions: [...dining, ...hobby],
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

function simInput(budgetYen: number, trials = 1000) {
  const { fitted, decomposed } = buildFitted();
  return {
    fitted,
    input: {
      periodId: '2026-10-01_2026-10-31',
      today: TODAY,
      periodTo: '2026-10-31',
      fitted,
      committedYen: decomposed.committed.scheduledYen + decomposed.committed.fixedYen,
      actualYen: decomposed.actualYen,
      specialHistoricalAmounts: decomposed.special.historicalAmounts,
      specialOccurrencesPerDay: decomposed.special.occurrencesPerDay,
      remainingDays: 17,
      budgetYen,
      payday: null,
      dataVersion: 'v1',
      trials,
      categoryBases: decomposed.periodByCategory,
      categoryTargets: new Map([['dining', 40000]]),
    },
  };
}

describe('buildActionCandidates(M5)', () => {
  it('上位ドライバーのカテゴリごとに「あと1回」「週1回」「1日おき」の3種類を作る', () => {
    const { fitted } = buildFitted();
    const candidates = buildActionCandidates(
      [
        { categoryId: 'dining', categoryName: '外食', shareOfRisk: 0.7 },
        { categoryId: 'hobby', categoryName: '娯楽', shareOfRisk: 0.3 },
      ],
      fitted.categories,
      17,
      2,
    );
    expect(candidates.map((c) => c.label)).toEqual([
      'あと1回へらす',
      '週1回へらす',
      '1日おきにする',
      'あと1回へらす',
      '週1回へらす',
      '1日おきにする',
    ]);
    expect(candidates[0]!.description).toBe('外食をあと1回へらす');
  });

  it('残りが1週間未満なら「週1回へらす」は出さない。maxCategoriesで対象を絞る', () => {
    const { fitted } = buildFitted();
    const candidates = buildActionCandidates(
      [
        { categoryId: 'dining', categoryName: '外食', shareOfRisk: 0.7 },
        { categoryId: 'hobby', categoryName: '娯楽', shareOfRisk: 0.3 },
      ],
      fitted.categories,
      3,
      1,
    );
    expect(candidates.map((c) => c.label)).toEqual(['あと1回へらす', '1日おきにする']);
  });

  it('週ごとの選択肢は、残りの週数ぶんの回数をへらす', () => {
    const [w1, w2] = weeklyReductionCandidates('dining', '外食', 14);
    expect(w1!.effect).toEqual({ type: 'reduce_count', count: 2 });
    expect(w2!.effect).toEqual({ type: 'reduce_count', count: 4 });
  });
});

describe('simulateActions(M5、共通乱数法)', () => {
  it('変動費を減らす打ち手で、着地額(p50)は増えない', () => {
    const { fitted, input } = simInput(100000);
    const candidates = buildActionCandidates(
      [{ categoryId: 'dining', categoryName: '外食', shareOfRisk: 1 }],
      fitted.categories,
      17,
      1,
    );
    const results = simulateActions(input, candidates);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.newP50).toBeLessThanOrEqual(r.baselineP50);
      expect(r.totalDelta).toBeLessThanOrEqual(0);
    }
  });

  it('変動費を減らす打ち手で、予算内に収まる確率・カテゴリの目標超えの確率は悪くならない', () => {
    const { input } = simInput(80000);
    const baseline = simulateActions(input, [keepAsIs('dining', '外食')])[0]!;
    const results = simulateActions(input, weeklyReductionCandidates('dining', '外食', 17));
    for (const r of results) {
      expect(r.probDelta!).toBeGreaterThanOrEqual(0);
      expect(r.category.probOverTarget!).toBeLessThanOrEqual(baseline.category.probOverTarget!);
    }
    // 「いつも通り」は基準そのもの(差が0)
    expect(baseline.probDelta).toBe(0);
    expect(baseline.totalDelta).toBe(0);
  });

  it('同じデータ・同じシードなら結果が完全に一致する(決定論)', () => {
    const { input } = simInput(100000, 500);
    const candidates = weeklyReductionCandidates('dining', '外食', 17);
    expect(simulateActions(input, candidates)).toEqual(simulateActions(input, candidates));
  });
});

describe('topActions', () => {
  function result(id: string, probDelta: number, totalDelta: number): ActionResult {
    return {
      action: {
        categoryId: id,
        categoryName: id,
        label: '',
        description: '',
        effect: { type: 'reduce_count', count: 1 },
      },
      baselineProbWithinBudget: 0.5,
      newProbWithinBudget: 0.5 + probDelta,
      probDelta,
      baselineP50: 100,
      newP50: 100 + totalDelta,
      totalDelta,
      newTotal: { p10: 0, p50: 100 + totalDelta, p90: 0 },
      category: { landing: { p10: 0, p50: 0, p90: 0 }, targetYen: null, probOverTarget: null },
    };
  }

  it('確率の改善が大きい順に並べ、指定件数までに絞る。効果の無いものは出さない', () => {
    const top = topActions(
      [result('a', 0.1, -10), result('b', 0.3, -30), result('c', 0.05, -5), result('d', 0, 0)],
      2,
    );
    expect(top.map((r) => r.action.categoryId)).toEqual(['b', 'a']);
  });
});
