import { describe, expect, it } from 'vitest';

import {
  assertContributionAmountYen,
  assertProductName,
  assertSnapshotCostBasisYen,
  assertSnapshotValueYen,
  computeInvestmentPlan,
  InvestmentError,
  totalInvestmentValueAsOf,
  type InvestmentSnapshotPoint,
} from '@/domain/investment';

describe('computeInvestmentPlan(FR-50)', () => {
  it('毎月の貯金目標に比率を掛けた額が投資総額になる', () => {
    const plan = computeInvestmentPlan({
      monthlySavingsTargetYen: 100_000,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
  });

  it('高リスク枠を使わないときは全額インデックス枠になる(FR-52)', () => {
    const plan = computeInvestmentPlan({
      monthlySavingsTargetYen: 100_000,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.indexYen).toBe(20_000);
    expect(plan.highRiskYen).toBe(0);
  });

  it('高リスク枠を使うときは比率どおりに分かれる', () => {
    const plan = computeInvestmentPlan({
      monthlySavingsTargetYen: 100_000,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: true,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
    expect(plan.highRiskYen).toBe(6_000);
    expect(plan.indexYen).toBe(14_000);
  });

  it('インデックス枠と高リスク枠の合計は総額と一致する(端数を含めて)', () => {
    const plan = computeInvestmentPlan({
      monthlySavingsTargetYen: 77_777,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: true,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.indexYen + plan.highRiskYen).toBe(plan.totalYen);
  });

  it('円未満は四捨五入する', () => {
    const plan = computeInvestmentPlan({
      monthlySavingsTargetYen: 100_001,
      investmentRatioOfSavings: 0.2,
      isHighRiskUnlocked: false,
      highRiskAllocationRatio: 0.3,
    });
    expect(plan.totalYen).toBe(20_000);
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

function point(productKey: string, asOf: string, marketValueYen: number): InvestmentSnapshotPoint {
  return { productKey, asOf, marketValueYen };
}

describe('totalInvestmentValueAsOf(P6-3)', () => {
  it('商品ごとに最新のスナップショットだけを合算する', () => {
    const total = totalInvestmentValueAsOf(
      [point('p1', '2026-07-01', 100_000), point('p1', '2026-08-01', 120_000)],
      '2026-09-30',
    );
    expect(total).toBe(120_000);
  });

  it('複数商品はそれぞれの最新値を合算する', () => {
    const total = totalInvestmentValueAsOf(
      [point('p1', '2026-08-01', 100_000), point('p2', '2026-08-15', 50_000)],
      '2026-09-30',
    );
    expect(total).toBe(150_000);
  });

  it('指定日より後のスナップショットは無視する', () => {
    const total = totalInvestmentValueAsOf(
      [point('p1', '2026-08-01', 100_000), point('p1', '2026-10-01', 200_000)],
      '2026-09-30',
    );
    expect(total).toBe(100_000);
  });

  it('指定日以前の記録が無い商品は0として無視する', () => {
    const total = totalInvestmentValueAsOf([point('p1', '2026-10-01', 200_000)], '2026-09-30');
    expect(total).toBe(0);
  });

  it('スナップショットが無ければ0', () => {
    expect(totalInvestmentValueAsOf([], '2026-09-30')).toBe(0);
  });
});
