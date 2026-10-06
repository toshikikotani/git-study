import { describe, expect, it } from 'vitest';

import { todayAllowance, todaySentence } from '@/domain/forecast/today';

describe('todayAllowance(設計書 v3 3.1)', () => {
  it('1日の上限から、今日使った額を引く', () => {
    expect(todayAllowance({ capYen: 2400, spentTodayYen: 300 })).toEqual({
      kind: 'left',
      capYen: 2400,
      spentYen: 300,
      leftYen: 2100,
    });
  });

  it('上限を超えたら、超えた額を出す', () => {
    const t = todayAllowance({ capYen: 2400, spentTodayYen: 3000 })!;
    expect(t).toMatchObject({ kind: 'over', overYen: 600 });
    expect(todaySentence(t, (y) => `${y}円`)).toBe('今日は1日の上限を600円超えています。');
  });

  it('予算が無ければ出さない', () => {
    expect(todayAllowance({ capYen: null, spentTodayYen: 0 })).toBeNull();
  });

  it('読み上げは、今日あと使える額から', () => {
    const t = todayAllowance({ capYen: 2400, spentTodayYen: 300 })!;
    expect(todaySentence(t, (y) => `${y}円`)).toBe('今日あと2100円使えます。');
  });
});
