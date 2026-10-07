import { describe, expect, it } from 'vitest';

import { lockedSavingsYen, sinkingFromRules } from '@/domain/locked-savings';

describe('確保した貯蓄', () => {
  it('手取りから積立・予定・自由上限を引く', () => {
    expect(
      lockedSavingsYen({
        incomeYen: 300000,
        sinkingYen: 20000,
        scheduledYen: 51540,
        discretionaryCapYen: 40000,
      }),
    ).toBe(188460);
  });

  it('手取りが無い月は計算しない', () => {
    expect(
      lockedSavingsYen({
        incomeYen: 0,
        sinkingYen: 0,
        scheduledYen: 51540,
        discretionaryCapYen: 10500,
      }),
    ).toBeNull();
  });

  it('積立は投資・積立の固定ルールだけ。残りを受け取るルールは引かない', () => {
    expect(
      sinkingFromRules([
        { name: '貯金へ', amountType: 'fixed', amountYen: 30000 },
        { name: '投資', amountType: 'fixed', amountYen: 10000 },
        { name: '生活費', amountType: 'remainder', amountYen: null },
      ]),
    ).toBe(10000);
  });
});
