import { describe, expect, it } from 'vitest';

import { lockedSavingsYen } from '@/domain/locked-savings';

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
});
