import { describe, expect, it } from 'vitest';

import {
  findOverlap,
  overlapMessage,
  periodsOverlap,
  pickCurrentPlan,
  reservationStart,
} from '@/domain/plan-periods';

const plans = [
  { id: 'a', periodStart: '2026-09-22', periodEnd: '2026-09-28' },
  { id: 'b', periodStart: '2026-09-29', periodEnd: '2026-10-06' },
  { id: 'c', periodStart: '2026-10-07', periodEnd: '2026-10-13' },
];

describe('期間の重なり(受け入れ基準4)', () => {
  it('開始日・終了日を含めて重なりを判定する', () => {
    expect(
      periodsOverlap(
        { start: '2026-09-29', end: '2026-10-06' },
        { start: '2026-10-06', end: '2026-10-10' },
      ),
    ).toBe(true);
    expect(
      periodsOverlap(
        { start: '2026-09-29', end: '2026-10-06' },
        { start: '2026-10-07', end: '2026-10-10' },
      ),
    ).toBe(false);
  });

  it('進行中の目標と重なる期間は作れない(理由つき)', () => {
    const conflict = findOverlap(plans, { start: '2026-10-05', end: '2026-10-12' });
    expect(conflict?.id).toBe('b');
    expect(overlapMessage(conflict!)).toContain('重なっています');
  });

  it('終了日の翌日から始まる予約は作れる', () => {
    expect(reservationStart('2026-10-13')).toBe('2026-10-14');
    expect(findOverlap(plans, { start: '2026-10-14', end: '2026-10-20' })).toBeNull();
  });

  it('自分自身は無視できる(期間の編集用)', () => {
    expect(findOverlap(plans, { start: '2026-09-29', end: '2026-10-06' }, 'b')).toBeNull();
  });
});

describe('pickCurrentPlan', () => {
  it('今日を含む目標 > 直近に終わった目標 > いちばん近い予約', () => {
    expect(pickCurrentPlan(plans, '2026-10-01')?.id).toBe('b');
    expect(pickCurrentPlan(plans, '2026-10-20')?.id).toBe('c');
    expect(pickCurrentPlan(plans, '2026-09-01')?.id).toBe('a');
    expect(pickCurrentPlan([], '2026-09-01')).toBeNull();
  });
});
