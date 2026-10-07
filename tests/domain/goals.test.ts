import { describe, expect, it } from 'vitest';

import { assertGoalTargetAmountYen, assertGoalTitle, GoalError } from '@/domain/goals';

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
