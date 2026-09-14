import { describe, expect, it } from 'vitest';

import {
  assertGoalCurrentAmountYen,
  assertGoalTargetAmountYen,
  assertGoalTitle,
  daysUntilTarget,
  goalProgressRatio,
  GoalError,
} from '@/domain/goals';

describe('assertGoalTitle', () => {
  it('前後の空白を除いて返す', () => {
    expect(assertGoalTitle('  旅行費用  ')).toBe('旅行費用');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertGoalTitle('')).toThrow(GoalError);
    expect(() => assertGoalTitle('   ')).toThrow(GoalError);
  });
});

describe('assertGoalTargetAmountYen', () => {
  it('null はそのまま通す(金額の目標を持たない場合)', () => {
    expect(assertGoalTargetAmountYen(null)).toBeNull();
  });

  it('正の整数はそのまま通す', () => {
    expect(assertGoalTargetAmountYen(150_000)).toBe(150_000);
  });

  it('0以下・小数は拒否する', () => {
    expect(() => assertGoalTargetAmountYen(0)).toThrow(GoalError);
    expect(() => assertGoalTargetAmountYen(-1)).toThrow(GoalError);
    expect(() => assertGoalTargetAmountYen(1.5)).toThrow(GoalError);
  });
});

describe('assertGoalCurrentAmountYen', () => {
  it('0以上の整数はそのまま通す', () => {
    expect(assertGoalCurrentAmountYen(0)).toBe(0);
    expect(assertGoalCurrentAmountYen(1_000)).toBe(1_000);
  });

  it('負の値・小数は拒否する', () => {
    expect(() => assertGoalCurrentAmountYen(-1)).toThrow(GoalError);
    expect(() => assertGoalCurrentAmountYen(1.5)).toThrow(GoalError);
  });
});

describe('goalProgressRatio', () => {
  it('現在額/目標額を返す', () => {
    expect(goalProgressRatio({ targetAmountYen: 100_000, currentAmountYen: 25_000 })).toBe(0.25);
  });

  it('目標額が無ければ null(0%と誤読させない)', () => {
    expect(goalProgressRatio({ targetAmountYen: null, currentAmountYen: 5_000 })).toBeNull();
  });

  it('目標額を超えても1を超えた値を返す(切らない)', () => {
    expect(goalProgressRatio({ targetAmountYen: 10_000, currentAmountYen: 12_000 })).toBe(1.2);
  });
});

describe('daysUntilTarget', () => {
  it('期限までの残り日数を返す', () => {
    expect(daysUntilTarget('2026-10-01', '2026-09-13')).toBe(18);
  });

  it('期限が無ければ null', () => {
    expect(daysUntilTarget(null, '2026-09-13')).toBeNull();
  });

  it('期限を過ぎていれば負の値', () => {
    expect(daysUntilTarget('2026-09-01', '2026-09-13')).toBe(-12);
  });
});
