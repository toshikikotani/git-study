import { describe, expect, it } from 'vitest';

import { goalLanding } from '@/domain/goal-range';

describe('目標と照らした着地範囲', () => {
  it('ペースの点予測と、完了月のばらつきから90%区間を出す', () => {
    const range = goalLanding({
      targetYen: 100000,
      spentYen: 40000,
      scheduledYen: 5000,
      elapsedDays: 10,
      totalDays: 31,
      history: [80000, 90000, 110000],
    });
    expect(range?.pointYen).toBeGreaterThan(range!.targetYen);
    expect(range?.lowYen).toBeLessThan(range!.pointYen);
    expect(range?.highYen).toBeGreaterThan(range!.pointYen);
    expect(range?.saveYen).toBe(range!.pointYen - range!.targetYen);
  });
});
