import { describe, expect, it } from 'vitest';

import { computePlanActualDelta } from '@/domain/debt-payment';
import type { PayoffRow } from '@/domain/payoff';

function row(overrides: Partial<PayoffRow>): PayoffRow {
  return {
    monthIndex: 1,
    dueOn: '2026-10-25',
    openingBalanceYen: 0,
    interestYen: 0,
    principalYen: 0,
    paymentYen: 0,
    closingBalanceYen: 0,
    ...overrides,
  };
}

describe('computePlanActualDelta', () => {
  it('計画どおりなら差分は0', () => {
    const plan = [row({ monthIndex: 1, closingBalanceYen: 90_000 })];
    expect(computePlanActualDelta(plan, 1, 90_000)).toEqual({
      plannedBalanceYen: 90_000,
      actualBalanceYen: 90_000,
      deltaYen: 0,
    });
  });

  it('計画より残高が多ければ正(遅れている)', () => {
    const plan = [row({ monthIndex: 1, closingBalanceYen: 90_000 })];
    const result = computePlanActualDelta(plan, 1, 95_000);
    expect(result.deltaYen).toBe(5_000);
  });

  it('計画より残高が少なければ負(進んでいる)', () => {
    const plan = [row({ monthIndex: 1, closingBalanceYen: 90_000 })];
    const result = computePlanActualDelta(plan, 1, 80_000);
    expect(result.deltaYen).toBe(-10_000);
  });

  it('2回目の返済は plan の2番目の行と比べる', () => {
    const plan = [
      row({ monthIndex: 1, closingBalanceYen: 90_000 }),
      row({ monthIndex: 2, closingBalanceYen: 80_000 }),
    ];
    const result = computePlanActualDelta(plan, 2, 82_000);
    expect(result.plannedBalanceYen).toBe(80_000);
    expect(result.deltaYen).toBe(2_000);
  });

  it('計画がその回より先に完済していれば、計画残高は0円として扱う', () => {
    const plan = [row({ monthIndex: 1, closingBalanceYen: 0 })];
    const result = computePlanActualDelta(plan, 3, 5_000);
    expect(result.plannedBalanceYen).toBe(0);
    expect(result.deltaYen).toBe(5_000);
  });
});
