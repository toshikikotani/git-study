import { describe, expect, it } from 'vitest';

import {
  assertContributionAmountYen,
  assertProductName,
  assertSnapshotCostBasisYen,
  assertSnapshotValueYen,
  computeInvestmentPlan,
  InvestmentError,
  isFullyPaidOff,
} from '@/domain/investment';

describe('computeInvestmentPlan(FR-50)', () => {
  it('返済目標額に比率を掛けた額が投資総額になる', () => {
    const plan = computeInvestmentPlan({
      monthlyRepaymentTargetYen: 100_000,
      investmentRatioOfRepayment: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
  });

  it('完済前(高リスク枠未解禁)は全額インデックス枠になる(FR-52)', () => {
    const plan = computeInvestmentPlan({
      monthlyRepaymentTargetYen: 100_000,
      investmentRatioOfRepayment: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.indexYen).toBe(20_000);
    expect(plan.highRiskYen).toBe(0);
  });

  it('高リスク枠解禁後は比率どおりに分かれる', () => {
    const plan = computeInvestmentPlan({
      monthlyRepaymentTargetYen: 100_000,
      investmentRatioOfRepayment: 0.2,
      isHighRiskUnlocked: true,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
    expect(plan.highRiskYen).toBe(6_000);
    expect(plan.indexYen).toBe(14_000);
  });

  it('インデックス枠と高リスク枠の合計は総額と一致する(端数を含めて)', () => {
    const plan = computeInvestmentPlan({
      monthlyRepaymentTargetYen: 77_777,
      investmentRatioOfRepayment: 0.2,
      isHighRiskUnlocked: true,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.indexYen + plan.highRiskYen).toBe(plan.totalYen);
  });

  it('円未満は四捨五入する', () => {
    const plan = computeInvestmentPlan({
      monthlyRepaymentTargetYen: 100_001,
      investmentRatioOfRepayment: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
  });
});

describe('isFullyPaidOff(FR-52)', () => {
  it('active な負債が1件でもあれば完済ではない', () => {
    expect(
      isFullyPaidOff([{ status: 'paid_off' }, { status: 'active' }, { status: 'paid_off' }]),
    ).toBe(false);
  });

  it('全件が paid_off なら完済', () => {
    expect(isFullyPaidOff([{ status: 'paid_off' }, { status: 'paid_off' }])).toBe(true);
  });

  it('refinanced・closed は返済負担として残っていない扱いにする', () => {
    expect(isFullyPaidOff([{ status: 'refinanced' }, { status: 'closed' }])).toBe(true);
  });

  it('負債を一度も登録していなければ完済に含めない', () => {
    expect(isFullyPaidOff([])).toBe(false);
  });
});

describe('assertContributionAmountYen(FR-51)', () => {
  it('1円以上の整数は許可する', () => {
    expect(assertContributionAmountYen(1)).toBe(1);
    expect(assertContributionAmountYen(30000)).toBe(30000);
  });

  it('0以下・小数は拒否する', () => {
    expect(() => assertContributionAmountYen(0)).toThrow(InvestmentError);
    expect(() => assertContributionAmountYen(-1)).toThrow(InvestmentError);
    expect(() => assertContributionAmountYen(1.5)).toThrow(/拠出額/);
  });
});

describe('assertSnapshotValueYen(FR-51)', () => {
  it('0以上の整数は許可する', () => {
    expect(assertSnapshotValueYen(0)).toBe(0);
    expect(assertSnapshotValueYen(500000)).toBe(500000);
  });

  it('負数・小数は拒否する', () => {
    expect(() => assertSnapshotValueYen(-1)).toThrow(InvestmentError);
    expect(() => assertSnapshotValueYen(1.5)).toThrow(/残高/);
  });
});

describe('assertSnapshotCostBasisYen(FR-51)', () => {
  it('null は任意入力としてそのまま通す', () => {
    expect(assertSnapshotCostBasisYen(null)).toBeNull();
  });

  it('0以上の整数は許可する', () => {
    expect(assertSnapshotCostBasisYen(0)).toBe(0);
    expect(assertSnapshotCostBasisYen(450000)).toBe(450000);
  });

  it('負数は拒否する', () => {
    expect(() => assertSnapshotCostBasisYen(-1)).toThrow(/取得額/);
  });
});

describe('assertProductName', () => {
  it('前後の空白を取り除く', () => {
    expect(assertProductName('  eMAXIS Slim 全世界株式  ')).toBe('eMAXIS Slim 全世界株式');
  });

  it('空文字・空白のみは拒否する', () => {
    expect(() => assertProductName('')).toThrow(InvestmentError);
    expect(() => assertProductName('   ')).toThrow(/商品名/);
  });
});
