import { describe, expect, it } from 'vitest';

import {
  canShowForecast,
  countRecordedDays,
  hasIncome,
  paceComparison,
} from '@/domain/summary-rules';

describe('paceComparison(前月比較)', () => {
  const base = {
    today: '2026-09-29',
    lastMonthSameDay: '2026-08-29',
    dayOfMonth: 29,
    thisMonthToDateYen: 31542,
    lastMonthSameDayYen: 0,
  };

  it('前月のデータが無いときは比較を出さず「記録開始からN日」(受け入れ基準5)', () => {
    // 9/21 に記録を始めた = 9日目
    expect(paceComparison({ ...base, firstRecordedOn: '2026-09-21' })).toEqual({
      kind: 'since_start',
      days: 9,
    });
  });

  it('先月の同じ日より前から記録があれば比較する', () => {
    expect(
      paceComparison({ ...base, firstRecordedOn: '2026-08-01', lastMonthSameDayYen: 20000 }),
    ).toEqual({
      kind: 'compare',
      dayOfMonth: 29,
      lastYen: 20000,
      diffYen: 11542,
    });
  });

  it('記録が1件も無ければ何も出さない', () => {
    expect(paceComparison({ ...base, firstRecordedOn: null })).toEqual({ kind: 'none' });
  });
});

describe('月末予測・収入', () => {
  it('記録日数が7日未満なら予測を出さない', () => {
    expect(canShowForecast(6)).toBe(false);
    expect(canShowForecast(7)).toBe(true);
  });

  it('記録開始から9日目でも、記録のある日が5日なら予測を出さない(受け入れ基準5)', () => {
    const days = countRecordedDays([
      '2026-09-21',
      '2026-09-22',
      '2026-09-22',
      '2026-09-25',
      '2026-09-27',
      '2026-09-29',
    ]);
    expect(days).toBe(5);
    expect(canShowForecast(days)).toBe(false);
  });

  it('収入 0 円は未登録として扱う', () => {
    expect(hasIncome(0)).toBe(false);
    expect(hasIncome(250000)).toBe(true);
  });
});
