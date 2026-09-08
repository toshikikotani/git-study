import { describe, expect, it } from 'vitest';

import { DebtError, assertLenderName, assertPaymentDay } from '@/domain/debt';

describe('assertLenderName', () => {
  it('前後の空白を落として返す', () => {
    expect(assertLenderName('  楽天カード  ')).toBe('楽天カード');
  });

  it('空文字は拒否する', () => {
    expect(() => assertLenderName('')).toThrow(DebtError);
  });

  it('空白だけの入力は拒否する', () => {
    expect(() => assertLenderName('   ')).toThrow(/借入先/);
  });
});

describe('assertPaymentDay', () => {
  it('1〜31 の整数を受け付ける', () => {
    expect(assertPaymentDay(1)).toBe(1);
    expect(assertPaymentDay(27)).toBe(27);
    expect(assertPaymentDay(31)).toBe(31);
  });

  it('0 は拒否する', () => {
    expect(() => assertPaymentDay(0)).toThrow(DebtError);
  });

  it('32 は拒否する', () => {
    expect(() => assertPaymentDay(32)).toThrow(/1〜31/);
  });

  it('小数は拒否する', () => {
    expect(() => assertPaymentDay(27.5)).toThrow(DebtError);
  });

  it('負の値は拒否する', () => {
    expect(() => assertPaymentDay(-1)).toThrow(DebtError);
  });
});
