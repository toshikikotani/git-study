import { describe, expect, it } from 'vitest';

import {
  eachDay,
  elapsedDays,
  formatRemainingDays,
  periodDays,
  remainingDays,
} from '@/domain/period';

describe('期間の日数(今日を含める)', () => {
  const start = '2026-09-29';
  const end = '2026-10-06'; // 8日間

  it('期間の日数は開始日・終了日を含む', () => {
    expect(periodDays(start, end)).toBe(8);
  });

  it('初日は経過1日・残り8日(今日を含む)', () => {
    expect(elapsedDays(start, end, '2026-09-29')).toBe(1);
    expect(remainingDays(start, end, '2026-09-29')).toBe(8);
  });

  it('経過日数 + 残り日数 - 1 = 期間の日数(今日が二重に数えられる)', () => {
    for (const today of eachDay(start, end)) {
      expect(elapsedDays(start, end, today) + remainingDays(start, end, today) - 1).toBe(8);
    }
  });

  it('最終日は残り1日', () => {
    expect(remainingDays(start, end, end)).toBe(1);
  });

  it('開始前は経過0・残りは期間の全日数、終了後は残り0', () => {
    expect(elapsedDays(start, end, '2026-09-20')).toBe(0);
    expect(remainingDays(start, end, '2026-09-20')).toBe(8);
    expect(remainingDays(start, end, '2026-10-07')).toBe(0);
    expect(elapsedDays(start, end, '2026-10-07')).toBe(8);
  });

  it('画面に出す文言は1か所で決まる', () => {
    expect(formatRemainingDays(start, end, '2026-09-29')).toBe('残り8日');
    expect(formatRemainingDays(start, end, '2026-10-06')).toBe('残り1日');
    expect(formatRemainingDays(start, end, '2026-09-27')).toBe('2日後に開始');
    expect(formatRemainingDays(start, end, '2026-10-07')).toBe('終了');
  });
});
