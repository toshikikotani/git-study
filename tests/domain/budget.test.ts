import { describe, expect, it } from 'vitest';

import {
  budgetStatusFor,
  budgetTone,
  hasReachedAlertThreshold,
  netAmountYen,
  summarizeBudgets,
  totalSpentYen,
  type BudgetTransaction,
  type CategoryBudget,
} from '@/domain/budget';

const SANCTUARY: CategoryBudget = {
  categoryId: 'genre-sanctuary',
  budgetYen: 40_000,
  carryOverYen: 0,
};

const WASTE: CategoryBudget = {
  categoryId: 'genre-waste',
  budgetYen: 20_000,
  carryOverYen: 0,
};

/** 予算上限を持たないジャンル(貯金・投資など)。 */
const REPAYMENT: CategoryBudget = {
  categoryId: 'genre-repayment',
  budgetYen: null,
  carryOverYen: 0,
};

function spend(categoryId: string | null, amountYen: number): BudgetTransaction {
  return { categoryId, amountYen, isTransfer: false, reviewStatus: 'auto_ok' };
}

describe('summarizeBudgets', () => {
  it('支出を正の数に反転して集計する', () => {
    const [status] = summarizeBudgets([SANCTUARY], [spend('genre-sanctuary', -30_000)]);
    expect(status!.spentYen).toBe(30_000);
    expect(status!.remainingYen).toBe(10_000);
    expect(status!.usageRatio).toBeCloseTo(0.75);
  });

  it('支出が無いジャンルも結果に残す(枠の有無と未使用を区別する)', () => {
    const [status] = summarizeBudgets([WASTE], []);
    expect(status!.spentYen).toBe(0);
    expect(status!.remainingYen).toBe(20_000);
    expect(status!.transactionCount).toBe(0);
  });

  it('口座間振替は数えない(お金は減っていない)', () => {
    const [status] = summarizeBudgets(
      [SANCTUARY],
      [
        {
          categoryId: 'genre-sanctuary',
          amountYen: -30_000,
          isTransfer: true,
          reviewStatus: 'auto_ok',
        },
      ],
    );
    expect(status!.spentYen).toBe(0);
  });

  it('本人が対象外にした明細は数えない', () => {
    const [status] = summarizeBudgets(
      [SANCTUARY],
      [
        {
          categoryId: 'genre-sanctuary',
          amountYen: -30_000,
          isTransfer: false,
          reviewStatus: 'ignored',
        },
        spend('genre-sanctuary', -5_000),
      ],
    );
    expect(status!.spentYen).toBe(5_000);
  });

  it('確認待ちの明細も数える(見えている残額が後から減ると信用を失う)', () => {
    const [status] = summarizeBudgets(
      [SANCTUARY],
      [
        {
          categoryId: 'genre-sanctuary',
          amountYen: -8_000,
          isTransfer: false,
          reviewStatus: 'pending',
        },
      ],
    );
    expect(status!.spentYen).toBe(8_000);
  });

  it('返金(収入)は支出から差し引く', () => {
    const [status] = summarizeBudgets(
      [SANCTUARY],
      [spend('genre-sanctuary', -30_000), spend('genre-sanctuary', 5_000)],
    );
    expect(status!.spentYen).toBe(25_000);
  });

  it('未分類の明細はどのジャンルにも入れない', () => {
    const [status] = summarizeBudgets([SANCTUARY], [spend(null, -30_000)]);
    expect(status!.spentYen).toBe(0);
  });

  it('予算を超えると残額はマイナスになる(隠さない)', () => {
    const [status] = summarizeBudgets([WASTE], [spend('genre-waste', -25_000)]);
    expect(status!.remainingYen).toBe(-5_000);
    expect(status!.usageRatio).toBeCloseTo(1.25);
  });

  it('繰越を残額に加える', () => {
    const [status] = summarizeBudgets(
      [{ ...SANCTUARY, carryOverYen: 5_000 }],
      [spend('genre-sanctuary', -30_000)],
    );
    expect(status!.remainingYen).toBe(15_000);
  });

  it('予算未設定のジャンルは残額も消化率も null', () => {
    const [status] = summarizeBudgets([REPAYMENT], [spend('genre-repayment', -100_000)]);
    expect(status!.spentYen).toBe(100_000);
    expect(status!.remainingYen).toBeNull();
    expect(status!.usageRatio).toBeNull();
  });

  it('複数ジャンルを取り違えない', () => {
    const statuses = summarizeBudgets(
      [SANCTUARY, WASTE],
      [spend('genre-sanctuary', -30_000), spend('genre-waste', -8_000)],
    );
    expect(statuses.map((s) => [s.categoryId, s.spentYen])).toEqual([
      ['genre-sanctuary', 30_000],
      ['genre-waste', 8_000],
    ]);
  });
});

describe('budgetStatusFor', () => {
  it('1ジャンル分だけを返す', () => {
    const status = budgetStatusFor(SANCTUARY, [
      spend('genre-sanctuary', -12_000),
      spend('genre-waste', -8_000),
    ]);
    expect(status.spentYen).toBe(12_000);
    expect(status.remainingYen).toBe(28_000);
  });
});

describe('hasReachedAlertThreshold(FR-20)', () => {
  it('70% に到達したら true(100% を待たない)', () => {
    const status = budgetStatusFor(WASTE, [spend('genre-waste', -14_000)]);
    expect(hasReachedAlertThreshold(status, 0.7)).toBe(true);
  });

  it('69% では false', () => {
    const status = budgetStatusFor(WASTE, [spend('genre-waste', -13_000)]);
    expect(hasReachedAlertThreshold(status, 0.7)).toBe(false);
  });

  it('予算未設定のジャンルでは発火しない', () => {
    const status = budgetStatusFor(REPAYMENT, [spend('genre-repayment', -100_000)]);
    expect(hasReachedAlertThreshold(status, 0.7)).toBe(false);
  });

  it('閾値が範囲外ならエラー(0.7 を 70 と書く間違いを止める)', () => {
    const status = budgetStatusFor(WASTE, []);
    expect(() => hasReachedAlertThreshold(status, 70)).toThrow(RangeError);
    expect(() => hasReachedAlertThreshold(status, 0)).toThrow(RangeError);
  });
});

describe('netAmountYen / totalSpentYen', () => {
  const transactions: BudgetTransaction[] = [
    spend('genre-income', 250_000),
    spend('genre-sanctuary', -30_000),
    spend('genre-living', -50_000),
    {
      categoryId: 'genre-transfer',
      amountYen: -100_000,
      isTransfer: true,
      reviewStatus: 'auto_ok',
    },
  ];

  it('振替を除いた収支を返す(支出は負のまま)', () => {
    expect(netAmountYen(transactions)).toBe(170_000);
  });

  it('支出だけを正の数で合計する', () => {
    expect(totalSpentYen(transactions)).toBe(80_000);
  });

  it('空なら 0', () => {
    expect(netAmountYen([])).toBe(0);
    expect(totalSpentYen([])).toBe(0);
  });
});

describe('budgetTone(FR-20 / FR-64、ADR-057で聖域の例外を廃止)', () => {
  function status(budgetYen: number | null, spentYen: number) {
    return budgetStatusFor(
      { categoryId: 'g', budgetYen, carryOverYen: 0 },
      budgetYen === null ? [] : [spend('g', -spentYen)],
    );
  }

  it('余裕があれば normal', () => {
    expect(budgetTone(status(20_000, 5_000))).toBe('normal');
  });

  it('閾値(既定70%)に達したら attention', () => {
    expect(budgetTone(status(20_000, 14_000))).toBe('attention');
  });

  it('予算を超えたら over', () => {
    expect(budgetTone(status(20_000, 25_000))).toBe('over');
  });

  it('超過は常に隠さない(設計原則3は「叱らず見せる」)', () => {
    expect(budgetTone(status(40_000, 45_000))).toBe('over');
  });

  it('閾値は差し替えられる(app_settings.waste_alert_threshold)', () => {
    expect(budgetTone(status(20_000, 11_000), 0.5)).toBe('attention');
    expect(budgetTone(status(20_000, 11_000), 0.9)).toBe('normal');
  });

  it('予算未設定の枠は normal(超過の概念が無い。警告を出したくなければ予算を未設定のままにできる)', () => {
    expect(budgetTone(status(null, 100_000))).toBe('normal');
  });
});
