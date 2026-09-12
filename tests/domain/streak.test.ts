import { describe, expect, it } from 'vitest';

import { streakBadgeFor } from '@/domain/streak';

describe('streakBadgeFor(FR-62)', () => {
  it('3日未満はまだ出さない(祝うほどではない)', () => {
    expect(streakBadgeFor({ currentStreakDays: 2, longestStreakDays: 2 })).toEqual({
      kind: 'none',
    });
  });

  it('3日以上続いていれば継続日数を出す', () => {
    expect(streakBadgeFor({ currentStreakDays: 7, longestStreakDays: 7 })).toEqual({
      kind: 'active',
      days: 7,
    });
  });

  it('過去に3日以上続いたが今は途切れているなら再開を促す(責めない)', () => {
    expect(streakBadgeFor({ currentStreakDays: 0, longestStreakDays: 5 })).toEqual({
      kind: 'restart',
    });
  });

  it('一度も3日続いたことが無ければ何も出さない', () => {
    expect(streakBadgeFor({ currentStreakDays: 0, longestStreakDays: 1 })).toEqual({
      kind: 'none',
    });
  });
});
