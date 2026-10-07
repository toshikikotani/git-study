import { describe, expect, it } from 'vitest';

import { needsOnboarding, STARTER_GENRES, starterTargetYen } from '@/domain/onboarding';

describe('starterTargetYen', () => {
  it('手取りの割合を、期間の日数に割り戻して500円単位にする', () => {
    // 25万円 × 12% = 3万円/月 → 7日で 7,000円
    expect(starterTargetYen(250_000, 0.12, 7)).toBe(7_000);
    // 25万円 × 5% = 12,500円/月 → 30日でそのまま
    expect(starterTargetYen(250_000, 0.05, 30)).toBe(12_500);
  });

  it('手取りや日数が0なら0円', () => {
    expect(starterTargetYen(0, 0.12, 7)).toBe(0);
    expect(starterTargetYen(250_000, 0.12, 0)).toBe(0);
  });

  it('最初のジャンルは手取りの一部だけ(合計が手取りを超えない)', () => {
    const total = STARTER_GENRES.reduce((sum, g) => sum + g.shareOfTakeHome, 0);
    expect(total).toBeLessThan(1);
  });
});

describe('needsOnboarding', () => {
  it('目標も明細も無く、「あとで」も選んでいない人だけに出す', () => {
    expect(needsOnboarding({ hasPlan: false, hasTransactions: false, skipped: false })).toBe(true);
    expect(needsOnboarding({ hasPlan: true, hasTransactions: false, skipped: false })).toBe(false);
    expect(needsOnboarding({ hasPlan: false, hasTransactions: true, skipped: false })).toBe(false);
    expect(needsOnboarding({ hasPlan: false, hasTransactions: false, skipped: true })).toBe(false);
  });
});
