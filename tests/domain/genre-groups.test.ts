import { describe, expect, it } from 'vitest';

import {
  groupGenres,
  matchesGenreQuery,
  SHORT_NAME_MAX,
  shortGenreName,
} from '@/domain/genre-groups';

/** カテゴリを選ぶシートの「すべて」(v5 変更4、ADR-133)。 */
const DEFAULTS = [
  '食料品',
  '外食',
  'カフェ・飲料',
  '酒',
  '日用品',
  '衣服・ファッション',
  '美容',
  '医療・健康',
  '住居費',
  '光熱費',
  '通信費',
  '交通・車両',
  '娯楽・趣味',
  '書籍・学習',
  'サブスクリプション・会費',
  '交際費・贈答',
  'こども・教育',
  'ペット',
  '家電・家具',
  '旅行',
  '保険・税金・手数料',
  'その他',
].map((name, i) => ({ id: `g${i}`, name }));

describe('グループ分け', () => {
  it('食べる・暮らし・移動と旅・楽しむ・体と身なり・そのほか', () => {
    const groups = groupGenres(DEFAULTS);
    expect(groups.map((g) => [g.label, g.genres.map((x) => shortGenreName(x.name))])).toEqual([
      ['食べる', ['食料品', '外食', 'カフェ', '酒']],
      ['暮らし', ['日用品', '住居費', '光熱費', '通信費', '家電・家具']],
      ['移動と旅', ['交通・車両', '旅行']],
      ['楽しむ', ['娯楽・趣味', '書籍・学習', 'サブスク', '交際費']],
      ['体と身なり', ['医療・健康', '美容', '衣服']],
      ['そのほか', ['保険・税金', 'こども', 'ペット', 'その他']],
    ]);
    expect(groups.flatMap((g) => g.genres)).toHaveLength(DEFAULTS.length);
  });

  it('自分で足したカテゴリは、選んだアイコンのグループ(無ければそのほか)', () => {
    const groups = groupGenres(
      [
        { id: 'a', name: 'ランチ' },
        { id: 'b', name: 'ジム' },
      ],
      (name) => (name === 'ランチ' ? { icon: 'restaurant' } : null),
    );
    expect(groups.map((g) => [g.key, g.genres.map((x) => x.id)])).toEqual([
      ['eat', ['a']],
      ['other', ['b']],
    ]);
  });
});

describe('アイコンの下の短い名前', () => {
  it('折れない長さにする(「カフェ・飲料」→「カフェ」、「保険・税金・手数料」→「保険・税金」)', () => {
    expect(shortGenreName('カフェ・飲料')).toBe('カフェ');
    expect(shortGenreName('保険・税金・手数料')).toBe('保険・税金');
    for (const g of DEFAULTS) {
      expect(shortGenreName(g.name).length, g.name).toBeLessThanOrEqual(SHORT_NAME_MAX);
    }
  });

  it('足したカテゴリの長い名前は「・」の前まで', () => {
    expect(shortGenreName('ゲーム・アプリ課金')).toBe('ゲーム');
    expect(shortGenreName('ジム')).toBe('ジム');
  });
});

describe('さがす', () => {
  it('名前の一部で絞り込む(ひらがな・カタカナ、短い名前でも)', () => {
    expect(matchesGenreQuery('カフェ・飲料', 'かふぇ')).toBe(true);
    expect(matchesGenreQuery('保険・税金・手数料', '保険')).toBe(true);
    expect(matchesGenreQuery('サブスクリプション・会費', 'サブスク')).toBe(true);
    expect(matchesGenreQuery('外食', '保険')).toBe(false);
    expect(matchesGenreQuery('外食', '')).toBe(true);
  });
});
