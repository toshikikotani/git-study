import { describe, expect, it } from 'vitest';

import { predictGenres } from '@/domain/genre-prediction';

const genres = [
  { id: 'food', name: '食料品' },
  { id: 'cafe', name: 'カフェ・飲料' },
  { id: 'goods', name: '日用品' },
  { id: 'dining', name: '外食' },
  { id: 'health', name: '医療・健康' },
];

describe('predictGenres(未分類の予測上位3件)', () => {
  it('同じ店の履歴を最優先し、次に辞書、店の種類の順', () => {
    const r = predictGenres({
      storeName: 'ココカラファイン阪神大阪梅田駅店',
      itemNames: ["TULLY'S ラテ"],
      genres,
      history: [
        { storeName: 'ココカラファイン', genreId: 'health' },
        { storeName: 'ココカラファイン渋谷店', genreId: 'health' },
        { storeName: 'ローソン', genreId: 'food' },
      ],
    });
    expect(r.map((p) => [p.genreId, p.reason])).toEqual([
      ['health', 'history'],
      ['cafe', 'dictionary'],
      ['goods', 'store_type'],
    ]);
  });

  it('履歴が無くても常に3件出す(1タップで確定できる)', () => {
    const r = predictGenres({ storeName: '山田商店', genres, history: [] });
    expect(r).toHaveLength(3);
    expect(new Set(r.map((p) => p.genreId)).size).toBe(3);
  });

  it('存在しないジャンル(削除済み)は候補に出さない', () => {
    const r = predictGenres({
      storeName: 'ローソン',
      genres,
      history: [{ storeName: 'ローソン', genreId: 'deleted' }],
    });
    expect(r.every((p) => genres.some((g) => g.id === p.genreId))).toBe(true);
  });

  it('ジャンルが3件未満なら、あるだけ出す', () => {
    expect(predictGenres({ storeName: 'x', genres: genres.slice(0, 2), history: [] })).toHaveLength(
      2,
    );
  });
});
