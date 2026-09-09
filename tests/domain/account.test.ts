import { describe, expect, it } from 'vitest';

import {
  AccountError,
  assertAccountName,
  assertClosingDay,
  assertPaymentDay,
} from '@/domain/account';

describe('assertAccountName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertAccountName('  楽天カード  ')).toBe('楽天カード');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertAccountName('')).toThrow(AccountError);
    expect(() => assertAccountName('   ')).toThrow(/口座名/);
  });
});

describe('assertClosingDay', () => {
  it('null は任意入力としてそのまま通す', () => {
    expect(assertClosingDay(null)).toBeNull();
  });

  it('1〜31の整数は許可する', () => {
    expect(assertClosingDay(1)).toBe(1);
    expect(assertClosingDay(31)).toBe(31);
  });

  it('範囲外・小数は拒否する', () => {
    expect(() => assertClosingDay(0)).toThrow(AccountError);
    expect(() => assertClosingDay(32)).toThrow(/1〜31/);
    expect(() => assertClosingDay(15.5)).toThrow(AccountError);
  });
});

describe('assertPaymentDay', () => {
  it('null は任意入力としてそのまま通す', () => {
    expect(assertPaymentDay(null)).toBeNull();
  });

  it('1〜31の整数は許可する', () => {
    expect(assertPaymentDay(27)).toBe(27);
  });

  it('範囲外は拒否する', () => {
    expect(() => assertPaymentDay(-1)).toThrow(/1〜31/);
  });
});
