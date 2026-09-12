import { describe, expect, it } from 'vitest';

import {
  assertIncomeAmountYen,
  assertProjectName,
  assertWorkMinutes,
  computeHourlyRateYen,
  computeIncomeAllocation,
} from '@/domain/side-hustle';

describe('assertProjectName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertProjectName('  受託案件A  ')).toBe('受託案件A');
  });

  it('空文字は拒否する', () => {
    expect(() => assertProjectName('  ')).toThrow();
  });
});

describe('assertWorkMinutes', () => {
  it('1〜1440分の整数を受け付ける', () => {
    expect(assertWorkMinutes(90)).toBe(90);
    expect(assertWorkMinutes(1)).toBe(1);
    expect(assertWorkMinutes(1440)).toBe(1440);
  });

  it('範囲外・非整数は拒否する', () => {
    expect(() => assertWorkMinutes(0)).toThrow();
    expect(() => assertWorkMinutes(1441)).toThrow();
    expect(() => assertWorkMinutes(1.5)).toThrow();
  });
});

describe('assertIncomeAmountYen', () => {
  it('正の整数を受け付ける', () => {
    expect(assertIncomeAmountYen(50000)).toBe(50000);
  });

  it('0以下・非整数は拒否する', () => {
    expect(() => assertIncomeAmountYen(0)).toThrow();
    expect(() => assertIncomeAmountYen(-100)).toThrow();
    expect(() => assertIncomeAmountYen(100.5)).toThrow();
  });
});

describe('computeIncomeAllocation(FR-42)', () => {
  it('既定7:3で振り分ける', () => {
    const result = computeIncomeAllocation(100000, 0.7);
    expect(result).toEqual({ repaymentYen: 70000, investmentYen: 30000 });
  });

  it('端数は返済側に寄せる(合計が入金額と一致する)', () => {
    const result = computeIncomeAllocation(10000, 0.7);
    expect(result.repaymentYen + result.investmentYen).toBe(10000);
  });

  it('比率が範囲外なら拒否する', () => {
    expect(() => computeIncomeAllocation(1000, 1.5)).toThrow();
    expect(() => computeIncomeAllocation(1000, -0.1)).toThrow();
  });
});

describe('computeHourlyRateYen(FR-40)', () => {
  it('分と円から時給を算出する', () => {
    expect(computeHourlyRateYen(60, 3000)).toBe(3000);
    expect(computeHourlyRateYen(120, 3000)).toBe(1500);
  });

  it('作業時間が0なら null', () => {
    expect(computeHourlyRateYen(0, 3000)).toBeNull();
  });
});
