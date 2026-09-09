import { describe, expect, it } from 'vitest';

import { TransferRuleError, assertAmountShape, assertRuleName } from '@/domain/transfer-rule';
import { MoneyError } from '@/domain/money';

describe('assertRuleName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertRuleName('  返済へ  ')).toBe('返済へ');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertRuleName('')).toThrow(TransferRuleError);
    expect(() => assertRuleName('   ')).toThrow(/ルール名/);
  });
});

describe('assertAmountShape', () => {
  it('fixed は amountYen だけを埋める', () => {
    expect(assertAmountShape('fixed', '100000', '')).toEqual({
      amountYen: 100_000,
      percentage: null,
    });
  });

  it('fixed で0以下はエラー', () => {
    expect(() => assertAmountShape('fixed', '0', '')).toThrow(TransferRuleError);
  });

  it('fixed で数値でなければエラー(MoneyError)', () => {
    expect(() => assertAmountShape('fixed', 'abc', '')).toThrow(MoneyError);
  });

  it('percentage は percentage だけを埋める', () => {
    expect(assertAmountShape('percentage', '', '30')).toEqual({
      amountYen: null,
      percentage: 30,
    });
  });

  it('percentage は0より大きく100以下', () => {
    expect(() => assertAmountShape('percentage', '', '0')).toThrow(/0より大きく100以下/);
    expect(() => assertAmountShape('percentage', '', '101')).toThrow(/0より大きく100以下/);
  });

  it('remainder はどちらも null', () => {
    expect(assertAmountShape('remainder', '', '')).toEqual({
      amountYen: null,
      percentage: null,
    });
  });
});
