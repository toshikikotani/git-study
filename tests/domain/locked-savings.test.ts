import { describe, expect, it } from 'vitest';

import { lockedSavingsYen, obligationYen, sinkingFromRules } from '@/domain/locked-savings';

describe('確保した貯蓄', () => {
  it('手取りから義務・積立・予定・自由上限を引く', () => {
    expect(
      lockedSavingsYen({
        incomeYen: 300000,
        obligationYen: 80000,
        sinkingYen: 20000,
        scheduledYen: 51540,
        discretionaryCapYen: 40000,
      }),
    ).toBe(108460);
  });

  it('手取りが無い月は計算しない', () => {
    expect(
      lockedSavingsYen({
        incomeYen: 0,
        obligationYen: 0,
        sinkingYen: 0,
        scheduledYen: 51540,
        discretionaryCapYen: 10500,
      }),
    ).toBeNull();
  });

  it('義務は最低返済と返済目標の大きい方だけ', () => {
    expect(obligationYen(12000, 30000)).toBe(30000);
    expect(obligationYen(40000, 30000)).toBe(40000);
  });

  it('積立は投資・積立の固定ルールだけ。残りを受け取るルールは引かない', () => {
    expect(
      sinkingFromRules([
        { name: '返済', amountType: 'fixed', amountYen: 30000 },
        { name: '投資', amountType: 'fixed', amountYen: 10000 },
        { name: '生活費', amountType: 'remainder', amountYen: null },
      ]),
    ).toBe(10000);
  });
});
