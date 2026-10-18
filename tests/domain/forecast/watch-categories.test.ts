import { describe, expect, it } from 'vitest';

import type { LandingRow } from '@/domain/forecast/landing-rows';
import type { ForecastCategoryBand } from '@/domain/forecast/types';
import { WATCH_LIMIT, watchCategories } from '@/domain/forecast/watch-categories';

/**
 * ホームの「気をつけたいカテゴリ」(本人の案、ADR-117):手で選ばず、目標をこえた → こえそう →
 * 8割をこえた の順に最大3つ。固定費・予測を止めたカテゴリ・目標なしは出さない。
 */

function row(id: string, over: Partial<LandingRow> = {}): LandingRow {
  return {
    genreId: id,
    name: id,
    baseYen: 0,
    p10: 0,
    p50: 0,
    p90: 0,
    targetYen: 10_000,
    exceedance: 0,
    excludedYen: 0,
    status: 'forecast',
    type: 'steady',
    group: 'changeable',
    caution: null,
    cutPerWeekYen: null,
    ...over,
  };
}

const band = (id: string, actualYen: number) =>
  ({ categoryId: id, actualYen }) as unknown as ForecastCategoryBand;

describe('気をつけたいカテゴリ(ADR-117)', () => {
  it('こえた → こえそう → 8割をこえた の順。同じ段では額・割合の大きい順', () => {
    const picked = watchCategories({
      rows: [
        row('near', { p50: 9_000 }),
        row('risk', { p50: 12_000 }),
        row('over-small', { p50: 11_000 }),
        row('over-big', { p50: 15_000 }),
      ],
      byCategory: [
        band('near', 8_500),
        band('risk', 5_000),
        band('over-small', 10_500),
        band('over-big', 14_000),
      ],
      limit: 4,
    });
    expect(picked.map((c) => [c.genreId, c.tone])).toEqual([
      ['over-big', 'over'],
      ['over-small', 'over'],
      ['risk', 'risk'],
      ['near', 'near'],
    ]);
  });

  it('いちばん多くて3つ', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const picked = watchCategories({
      rows: ids.map((id) => row(id, { p50: 20_000 })),
      byCategory: ids.map((id) => band(id, 12_000)),
    });
    expect(WATCH_LIMIT).toBe(3);
    expect(picked).toHaveLength(3);
  });

  it('8割に届かず、こえそうでもなければ出さない(ちょうど8割は出す)', () => {
    const picked = watchCategories({
      rows: [row('calm', { p50: 9_000 }), row('edge', { p50: 9_500 })],
      byCategory: [band('calm', 7_999), band('edge', 8_000)],
    });
    expect(picked.map((c) => c.genreId)).toEqual(['edge']);
    expect(picked[0]).toMatchObject({ tone: 'near', spentYen: 8_000, targetYen: 10_000 });
  });

  it('見込みが目標内でも、注意(こえる確率が高い)が出ていれば「こえそう」', () => {
    const picked = watchCategories({
      rows: [
        row('caution', {
          p50: 9_000,
          caution: { categoryId: 'caution', kind: 'likely', overshootYen: 0, probability: 0.7 },
        }),
      ],
      byCategory: [band('caution', 3_000)],
    });
    expect(picked[0]?.tone).toBe('risk');
  });

  it('固定費(決まった型)・予測を止めたカテゴリ・目標なしは出さない', () => {
    const picked = watchCategories({
      rows: [
        row('rent', { group: 'fixed', type: 'fixed', p50: 80_000, targetYen: 80_000 }),
        row('closed', { p50: 20_000 }),
        row('none', { p50: 20_000, targetYen: null }),
        row('zero', { p50: 20_000, targetYen: 0 }),
      ],
      byCategory: [
        band('rent', 80_000),
        band('closed', 15_000),
        band('none', 15_000),
        band('zero', 1),
      ],
      closedGenreIds: new Set(['closed']),
    });
    expect(picked).toEqual([]);
  });
});
