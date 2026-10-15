import { describe, expect, it } from 'vitest';

import { groupLandingRows, type LandingRow } from '@/domain/forecast/landing-rows';

function row(name: string, baseYen: number, p50: number, targetYen: number | null): LandingRow {
  return {
    genreId: name,
    name,
    baseYen,
    p10: baseYen,
    p50,
    p90: p50 * 2,
    targetYen,
    exceedance: null,
    excludedYen: 0,
    status: 'forecast',
    type: 'steady',
    group: 'changeable',
    caution: null,
    cutPerWeekYen: null,
  } as LandingRow;
}

describe('予算の画面のカテゴリの分け方', () => {
  const groups = groupLandingRows([
    row('酒', 1175, 2400, 2600),
    row('娯楽', 39590, 39590, 33300),
    row('外食', 22752, 45000, 42500),
    row('日用品', 1878, 5500, 916),
    row('食料品', 13870, 20000, 30000),
    row('医療', 302, 302, null),
  ]);

  it('使った額で超えた → 見込みで超えそう → 予算内 → 予算なし', () => {
    expect(groups.over.map((r) => r.name)).toEqual(['娯楽', '日用品']);
    expect(groups.likely.map((r) => r.name)).toEqual(['外食']);
    expect(groups.within.map((r) => r.name)).toEqual(['食料品', '酒']);
    expect(groups.noBudget.map((r) => r.name)).toEqual(['医療']);
  });
});
