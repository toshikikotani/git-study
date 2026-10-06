import { describe, expect, it } from 'vitest';

import {
  effectiveGenreId,
  summarizeByGenre,
  summarizeMustPaySplit,
  type GenredEntry,
} from '@/domain/genre';

describe('summarizeByGenre', () => {
  it('ジャンルごとに合計し、金額の大きい順に並べる', () => {
    const entries: GenredEntry[] = [
      { genreId: 'g1', genreName: '外食', amountYen: 1000, mustPay: false },
      { genreId: 'g2', genreName: '食料品', amountYen: 3000, mustPay: false },
      { genreId: 'g1', genreName: '外食', amountYen: 500, mustPay: false },
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

describe('summarizeMustPaySplit', () => {
  it('絶対払わざるを得ないもの(must_pay)とそれ以外を分けて合計する', () => {
    const entries: GenredEntry[] = [
      { genreId: 'g1', genreName: '住居費', amountYen: 80_000, mustPay: true },
      { genreId: 'g2', genreName: '通信費', amountYen: 5_000, mustPay: true },
      { genreId: 'g3', genreName: '娯楽・趣味', amountYen: 10_000, mustPay: false },
    ];
    expect(summarizeMustPaySplit(entries)).toEqual({
      mustPayYen: 85_000,
      discretionaryYen: 10_000,
    });
  });

  it('空配列なら両方0円', () => {
    expect(summarizeMustPaySplit([])).toEqual({ mustPayYen: 0, discretionaryYen: 0 });
  });
});

describe('effectiveGenreId', () => {
  it('明細本体にジャンルがあればそれを優先する', () => {
    expect(effectiveGenreId('g1', [{ genreId: 'g2', amountYen: 500 }])).toBe('g1');
  });

  it('品目がすべて分類済みなら金額が最大のジャンルを代表にする', () => {
    expect(
      effectiveGenreId(null, [
        { genreId: 'g1', amountYen: 150 },
        { genreId: 'g2', amountYen: 800 },
        { genreId: 'g1', amountYen: 300 },
      ]),
    ).toBe('g2');
  });

  it('未分類の品目が1件でも残っていれば null', () => {
    expect(
      effectiveGenreId(null, [
        { genreId: 'g1', amountYen: 150 },
        { genreId: null, amountYen: 800 },
      ]),
    ).toBeNull();
  });

  it('品目が無ければ null', () => {
    expect(effectiveGenreId(null, [])).toBeNull();
  });
});
