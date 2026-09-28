import { describe, expect, it } from 'vitest';

import { summarizeByGenre, summarizeGenreByCategory, type GenredEntry } from '@/domain/genre';

describe('summarizeByGenre', () => {
  it('ジャンルごとに合計し、金額の大きい順に並べる', () => {
    const entries: GenredEntry[] = [
      { genreId: 'g1', genreName: '外食', amountYen: 1000, categoryName: '浪費' },
      { genreId: 'g2', genreName: '食料品', amountYen: 3000, categoryName: '生活費' },
      { genreId: 'g1', genreName: '外食', amountYen: 500, categoryName: '浪費' },
    ];
    expect(summarizeByGenre(entries)).toEqual([
      { genreId: 'g2', genreName: '食料品', totalYen: 3000 },
      { genreId: 'g1', genreName: '外食', totalYen: 1500 },
    ]);
  });

  it('空配列なら空を返す', () => {
    expect(summarizeByGenre([])).toEqual([]);
  });
});

describe('summarizeGenreByCategory', () => {
  it('カテゴリごとにジャンル内訳をまとめ、合計額の大きい順に並べる', () => {
    const entries: GenredEntry[] = [
      { genreId: 'g1', genreName: '外食', amountYen: 1000, categoryName: '浪費' },
      { genreId: 'g2', genreName: '酒', amountYen: 500, categoryName: '浪費' },
      { genreId: 'g3', genreName: '食料品', amountYen: 5000, categoryName: '生活費' },
    ];
    const result = summarizeGenreByCategory(entries);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      categoryName: '生活費',
      totalYen: 5000,
      genres: [{ genreId: 'g3', genreName: '食料品', totalYen: 5000 }],
    });
    expect(result[1]!.categoryName).toBe('浪費');
    expect(result[1]!.totalYen).toBe(1500);
    expect(result[1]!.genres).toEqual([
      { genreId: 'g1', genreName: '外食', totalYen: 1000 },
      { genreId: 'g2', genreName: '酒', totalYen: 500 },
    ]);
  });

  it('カテゴリが未設定なら「未分類」としてまとめる', () => {
    const entries: GenredEntry[] = [
      { genreId: 'g1', genreName: '外食', amountYen: 1000, categoryName: null },
    ];
    expect(summarizeGenreByCategory(entries)[0]!.categoryName).toBe('未分類');
  });
});
