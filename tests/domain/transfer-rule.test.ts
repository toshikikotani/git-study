import { describe, expect, it } from 'vitest';

import {
  TransferRuleError,
  assertAmountShape,
  assertRuleName,
  computeTransferPlan,
  type PlannableRule,
} from '@/domain/transfer-rule';
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

describe('computeTransferPlan', () => {
  const seedRules: PlannableRule[] = [
    { id: 'r1', name: '返済へ', amountType: 'fixed', amountYen: 100_000, percentage: null },
    { id: 'r2', name: '投資へ', amountType: 'fixed', amountYen: 20_000, percentage: null },
    { id: 'r3', name: '聖域枠へ', amountType: 'fixed', amountYen: 40_000, percentage: null },
    { id: 'r4', name: '生活費へ', amountType: 'remainder', amountYen: null, percentage: null },
  ];

  it('シードの4ルールを入金額300,000円に按分する(remainderが残りを受け取る)', () => {
    expect(computeTransferPlan(seedRules, 300_000)).toEqual([
      { ruleId: 'r1', label: '返済へ', plannedAmountYen: 100_000 },
      { ruleId: 'r2', label: '投資へ', plannedAmountYen: 20_000 },
      { ruleId: 'r3', label: '聖域枠へ', plannedAmountYen: 40_000 },
      { ruleId: 'r4', label: '生活費へ', plannedAmountYen: 140_000 },
    ]);
  });

  it('percentage ルールは入金額に対する割合で計算する', () => {
    const rules: PlannableRule[] = [
      { id: 'p1', name: '投資へ', amountType: 'percentage', amountYen: null, percentage: 20 },
      { id: 'p2', name: '生活費へ', amountType: 'remainder', amountYen: null, percentage: null },
    ];
    expect(computeTransferPlan(rules, 250_000)).toEqual([
      { ruleId: 'p1', label: '投資へ', plannedAmountYen: 50_000 },
      { ruleId: 'p2', label: '生活費へ', plannedAmountYen: 200_000 },
    ]);
  });

  it('fixed の合計が入金額を超える場合は、以降を0円に切り詰める(マイナスにしない)', () => {
    expect(computeTransferPlan(seedRules, 50_000)).toEqual([
      { ruleId: 'r1', label: '返済へ', plannedAmountYen: 50_000 },
      { ruleId: 'r2', label: '投資へ', plannedAmountYen: 0 },
      { ruleId: 'r3', label: '聖域枠へ', plannedAmountYen: 0 },
      { ruleId: 'r4', label: '生活費へ', plannedAmountYen: 0 },
    ]);
  });

  it('0以下の入金額は拒否する', () => {
    expect(() => computeTransferPlan(seedRules, 0)).toThrow(TransferRuleError);
    expect(() => computeTransferPlan(seedRules, -1)).toThrow(TransferRuleError);
  });

  it('ルールが1件も無ければ空配列を返す', () => {
    expect(computeTransferPlan([], 300_000)).toEqual([]);
  });
});
