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

import { savingsAsk } from '@/domain/plan-forecast';

describe('抑えてほしい額', () => {
  it('着地より下に抑える。予算に届くことは成功にしない', () => {
    const ask = savingsAsk({
      verdict: 'on_track',
      targetYen: 40000,
      medianYen: 26400,
      lowYen: 20500,
      committedYen: 2600,
      remainingDays: 29,
    });
    expect(ask.keepUnderYen).toBe(20500);
    expect(ask.saveYen).toBe(5900);
    expect(ask.text).toContain('届かせない方が貯蓄になる');
    expect(ask.text).not.toContain('目標に届く');
  });

  it('上限を超えている自由な支出は 0 円', () => {
    const ask = savingsAsk({
      verdict: 'unreachable',
      targetYen: 10500,
      medianYen: 18000,
      lowYen: 16000,
      committedYen: 12000,
      remainingDays: 29,
    });
    expect(ask.keepDailyYen).toBe(0);
  });
});

import { twoMonthTendency } from '@/domain/plan-forecast';

describe('過去2ヶ月の傾向', () => {
  it('増えているときは低い月に抑えた差を出す', () => {
    const result = twoMonthTendency({ priorYen: 18000, previousYen: 24000, landingYen: 26400 });
    expect(result.savedYen).toBe(8400);
    expect(result.text).toContain('増えている');
    expect(result.text).toContain('8,400 円残る');
  });
});
