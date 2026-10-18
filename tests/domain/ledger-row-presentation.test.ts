import { describe, expect, it } from 'vitest';

import { compactLedgerName, ledgerRowPresentation } from '@/domain/ledger-row-presentation';

const base = {
  name: '株式会社スギ薬局',
  genreId: 'goods',
  genreName: '日用品',
  amountYen: -1000,
};

describe('明細の2行表示', () => {
  it('品目のカテゴリを合算し、アイコンと文字を同じ並びに揃える', () => {
    const input = {
      ...base,
      items: [
        { name: '洗剤', genreId: 'goods', genreName: '日用品', amountYen: -350 },
        { name: 'パン', genreId: 'food', genreName: '食料品', amountYen: -300 },
        { name: '牛乳', genreId: 'food', genreName: '食料品', amountYen: -350 },
      ],
    };
    const original = structuredClone(input);
    expect(ledgerRowPresentation(input)).toEqual({
      name: 'スギ薬局',
      genreId: 'food',
      genreName: '食料品',
      categoryText: '食料品・日用品',
      itemSummary: '洗剤 ほか2',
      otherItemCount: 2,
      subtitle: '食料品・日用品 · 洗剤 ほか2',
      breakdown: [
        { genreId: 'food', genreName: '食料品', amountYen: 650 },
        { genreId: 'goods', genreName: '日用品', amountYen: 350 },
      ],
    });
    expect(input).toEqual(original);
  });

  it('同じカテゴリの品目は複数あっても内訳を増やさず、同額は初出順', () => {
    const summary = ledgerRowPresentation({
      ...base,
      items: [
        { name: 'パン', genreId: 'food', genreName: '食料品', amountYen: -200 },
        { name: 'タオル', genreId: 'goods', genreName: '日用品', amountYen: -400 },
        { name: '牛乳', genreId: 'food', genreName: '食料品', amountYen: -200 },
      ],
    });
    expect(summary.genreId).toBe('food');
    expect(summary.categoryText).toBe('食料品・日用品');
    expect(summary.breakdown).toHaveLength(2);
    const single = ledgerRowPresentation({
      ...base,
      items: [
        { name: '洗剤', genreId: 'goods', genreName: '日用品', amountYen: -400 },
        { name: 'タオル', genreId: 'goods', genreName: '日用品', amountYen: -600 },
      ],
    });
    expect(single.subtitle).toBe('日用品 · 洗剤 ほか1');
    expect(single.breakdown).toHaveLength(1);
  });

  it('品目のカテゴリが無いときは分割、それも無いときは親に戻る', () => {
    const items = [{ name: '商品', genreId: null, genreName: null, amountYen: -1000 }];
    expect(
      ledgerRowPresentation({
        ...base,
        items,
        splits: [
          { genreId: 'food', genreName: '食料品', amountYen: -600 },
          { genreId: 'goods', genreName: '日用品', amountYen: -400 },
        ],
      }),
    ).toMatchObject({ genreId: 'food', subtitle: '食料品・日用品 · 商品' });
    expect(ledgerRowPresentation({ ...base, items })).toMatchObject({
      genreId: 'goods',
      subtitle: '日用品 · 商品',
    });
    expect(ledgerRowPresentation({ ...base, genreId: null, genreName: null })).toMatchObject({
      genreId: null,
      genreName: null,
      subtitle: '未分類',
    });
  });

  it('一部の品目が未分類でも、読めた品目カテゴリを親より優先する', () => {
    expect(
      ledgerRowPresentation({
        ...base,
        items: [
          { name: '不明', genreId: null, genreName: null, amountYen: -900 },
          { name: 'パン', genreId: 'food', genreName: '食料品', amountYen: -100 },
        ],
        splits: [{ genreId: 'goods', genreName: '日用品', amountYen: -1000 }],
      }),
    ).toMatchObject({ genreId: 'food', genreName: '食料品', subtitle: '食料品 · 不明 ほか1' });
  });

  it('品目が無い・1件の場合に「ほか」を出さず、支出も収入も絶対額で並べる', () => {
    expect(ledgerRowPresentation(base).itemSummary).toBe('');
    expect(
      ledgerRowPresentation({
        ...base,
        items: [{ name: 'パン', genreId: 'food', genreName: '食料品', amountYen: 1000 }],
      }),
    ).toMatchObject({
      subtitle: '食料品 · パン',
      breakdown: [{ genreId: 'food', genreName: '食料品', amountYen: 1000 }],
    });
  });

  it('株式会社だけを表示名から省き、空になった店名には代替を出す', () => {
    expect(compactLedgerName('近畿日本鉄道株式会社')).toBe('近畿日本鉄道');
    expect(compactLedgerName('株式会社 スギ薬局')).toBe('スギ薬局');
    expect(compactLedgerName('有限会社お店')).toBe('有限会社お店');
    expect(compactLedgerName('株式会社')).toBe('店名なし');
    expect(compactLedgerName('  ')).toBe('店名なし');
  });
});
