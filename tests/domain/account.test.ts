import { describe, expect, it } from 'vitest';

import {
  AccountError,
  assertAccountName,
  assertClosingDay,
  assertPaymentDay,
  summarizeBalanceByPurpose,
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

describe('summarizeBalanceByPurpose', () => {
  it('同じ用途の口座を合算する', () => {
    const result = summarizeBalanceByPurpose([
      { purpose: 'living', currentBalanceYen: 100_000 },
      { purpose: 'living', currentBalanceYen: 50_000 },
      { purpose: 'investment', currentBalanceYen: 300_000 },
    ]);
    expect(result).toEqual([
      { purpose: 'investment', totalYen: 300_000, accountCount: 1 },
      { purpose: 'living', totalYen: 150_000, accountCount: 2 },
    ]);
  });

  it('クレジットカードの未払い残高(マイナス)も合算する', () => {
    const result = summarizeBalanceByPurpose([
      { purpose: 'living', currentBalanceYen: 100_000 },
      { purpose: 'repayment', currentBalanceYen: -30_000 },
    ]);
    const repayment = result.find((r) => r.purpose === 'repayment');
    expect(repayment).toEqual({ purpose: 'repayment', totalYen: -30_000, accountCount: 1 });
  });

  it('合計額の大きい順に並べる', () => {
    const result = summarizeBalanceByPurpose([
      { purpose: 'other', currentBalanceYen: 10_000 },
      { purpose: 'repayment', currentBalanceYen: -30_000 },
      { purpose: 'investment', currentBalanceYen: 300_000 },
    ]);
    expect(result.map((r) => r.purpose)).toEqual(['investment', 'other', 'repayment']);
  });

  it('口座が1件も無ければ空配列', () => {
    expect(summarizeBalanceByPurpose([])).toEqual([]);
  });
});
