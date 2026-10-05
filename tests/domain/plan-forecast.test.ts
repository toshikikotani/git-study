import { describe, expect, it } from 'vitest';

import { forecastPlan, landingReport } from '@/domain/plan-forecast';

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
  const forecasts = forecastPlan({
    genres: [{ ...base, scheduledYen: 3000 }],
    remainingDays: 10,
    seed: 'report',
    trials: 400,
  }).genres;

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
    const unknown = forecastPlan({
      genres: [{ ...base, observedDays: 3, scheduledYen: 0 }],
      remainingDays: 10,
      seed: 'unknown',
      trials: 400,
    }).genres;
    const report = landingReport({
      remainingDays: 10,
      rows: [{ ...row, scheduledYen: 0 }],
      forecasts: unknown,
    });
    expect(report.proposedTotalYen).toBeNull();
    expect(report.summary).toContain('まだ判断できるジャンルがありません');
  });
});
