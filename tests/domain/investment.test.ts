import { describe, expect, it } from 'vitest';

import { computeInvestmentPlan } from '@/domain/investment';

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
