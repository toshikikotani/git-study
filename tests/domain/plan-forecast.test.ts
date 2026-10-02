import { describe, expect, it } from 'vitest';

import { forecastPlan } from '@/domain/plan-forecast';

const base = {
  spentYen: 8000,
  scheduledYen: 0,
  meanDailyYen: 500,
  medianDailyYen: 400,
  observedDays: 20,
  targetYen: 20000,
};

describe('forecastPlan', () => {
  it('同じ入力なら着地は一致する', () => {
    const input = { genres: [base], remainingDays: 10, seed: 'period', trials: 400 };
    const a = forecastPlan(input);
    const b = forecastPlan(input);
    expect(a.genres[0]?.recommendedYen).toBe(b.genres[0]?.recommendedYen);
    expect(a.totalRecommendedYen).toBe(b.totalRecommendedYen);
  });

  it('予定を足すと中央値は予定額以上増える', () => {
    const plain = forecastPlan({ genres: [base], remainingDays: 10, seed: 's', trials: 400 });
    const withPlan = forecastPlan({
      genres: [{ ...base, scheduledYen: 3000 }],
      remainingDays: 10,
      seed: 's',
      trials: 400,
    });
    expect(withPlan.genres[0]!.medianYen! - plain.genres[0]!.medianYen!).toBeGreaterThanOrEqual(
      3000,
    );
  });

  it('支出日が少なく予定も無いときは目標を出さない', () => {
    const result = forecastPlan({
      genres: [{ ...base, observedDays: 3, scheduledYen: 0 }],
      remainingDays: 10,
      seed: 'early',
    });
    expect(result.genres[0]?.recommendedYen).toBeNull();
    expect(result.genres[0]?.verdict).toBe('unknown');
  });

  it('使った額と予定だけで目標以上なら届かない', () => {
    const result = forecastPlan({
      genres: [{ ...base, spentYen: 12000, scheduledYen: 9000, targetYen: 20000 }],
      remainingDays: 10,
      seed: 'over',
    });
    expect(result.genres[0]?.verdict).toBe('unreachable');
  });
});
