import { describe, expect, it } from 'vitest';

import {
  baselineForPeriod,
  clampAiTarget,
  fallbackTarget,
  nextPlanRange,
  planPeriodDays,
  planProgress,
} from '@/domain/spending-plan';

describe('planPeriodDays', () => {
  it('開始日と終了日を含めて数える', () => {
    expect(planPeriodDays('2026-09-29', '2026-09-29')).toBe(1);
    expect(planPeriodDays('2026-10-01', '2026-10-31')).toBe(31);
  });
});

describe('baselineForPeriod', () => {
  it('1日あたりの平均 × 期間の日数', () => {
    expect(baselineForPeriod(90000, 90, 30)).toBe(30000);
  });

  it('実績が無ければ0', () => {
    expect(baselineForPeriod(0, 30, 30)).toBe(0);
    expect(baselineForPeriod(1000, 0, 30)).toBe(0);
  });
});

describe('fallbackTarget', () => {
  it('課題のあるジャンルだけ、削れる部分をstepPercent削る', () => {
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0, isIssue: true }, 10)).toBe(27000);
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0, isIssue: false }, 10)).toBe(30000);
  });

  it('必須ラベルの部分は削らない', () => {
    // 削れるのは 30000 × (1-0.5) = 15000 の10% = 1500
    expect(fallbackTarget({ baselineYen: 30000, mustPayShare: 0.5, isIssue: true }, 10)).toBe(
      28500,
    );
  });

  it('実績が無ければ0', () => {
    expect(fallbackTarget({ baselineYen: 0, mustPayShare: 0, isIssue: true }, 10)).toBe(0);
  });
});

describe('clampAiTarget', () => {
  const facts = { baselineYen: 30000, mustPayShare: 0, isIssue: true };

  it('実績より増やさない', () => {
    expect(clampAiTarget(50000, facts, 10)).toBe(30000);
  });

  it('いきなり大きく削らない(stepPercentが下限)', () => {
    expect(clampAiTarget(5000, facts, 10)).toBe(27000);
    expect(clampAiTarget(5000, facts, 20)).toBe(24000);
  });

  it('範囲内の提案は100円単位に丸めて採用する', () => {
    expect(clampAiTarget(28430, facts, 10)).toBe(28400);
  });

  it('必須ラベルの部分は下限に含める', () => {
    expect(clampAiTarget(0, { baselineYen: 30000, mustPayShare: 1, isIssue: true }, 20)).toBe(
      30000,
    );
  });
});

describe('planProgress', () => {
  it('使用率と残りを返し、超過は over', () => {
    expect(planProgress(5000, 10000)).toMatchObject({ remainingYen: 5000, tone: 'normal' });
    expect(planProgress(7000, 10000).tone).toBe('attention');
    expect(planProgress(12000, 10000)).toMatchObject({ remainingYen: -2000, tone: 'over' });
  });

  it('目標が0円なら使用率は null', () => {
    expect(planProgress(0, 0).ratio).toBeNull();
  });
});

describe('nextPlanRange', () => {
  it('1回目は開始日、2回目は終了日になる', () => {
    const first = nextPlanRange({ start: null, end: null }, '2026-10-05');
    expect(first).toEqual({ start: '2026-10-05', end: null });
    expect(nextPlanRange(first, '2026-10-20')).toEqual({ start: '2026-10-05', end: '2026-10-20' });
  });

  it('開始日と同じ日をタップすると1日だけの期間になる', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: null }, '2026-10-05')).toEqual({
      start: '2026-10-05',
      end: '2026-10-05',
    });
  });

  it('開始日より前をタップしたら開始日を選び直す', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: null }, '2026-10-01')).toEqual({
      start: '2026-10-01',
      end: null,
    });
  });

  it('選び終わった後のタップは、その日から選び直す', () => {
    expect(nextPlanRange({ start: '2026-10-05', end: '2026-10-20' }, '2026-10-25')).toEqual({
      start: '2026-10-25',
      end: null,
    });
  });
});
