/**
 * カテゴリを選ぶシートの「すべて」の並び(v5 変更4、ADR-133)。並べ替えた順の一列ではなく、
 * グループに分けて絵のアイコンで並べる。アイコンの下で折れない短い名前も持たせる
 * (「カフェ・飲料」→「カフェ」、「保険・税金・手数料」→「保険・税金」)。
 *
 * 自分で足したカテゴリは、選んだアイコンでグループを決める(アイコンが無ければ「そのほか」)。
 */

import { genreStyle, type GenreIconKey, type GenreStyleOverride } from './genre-style';

export type GenreGroupKey = 'eat' | 'living' | 'move' | 'fun' | 'body' | 'other';

export const GENRE_GROUPS: readonly { key: GenreGroupKey; label: string }[] = [
  { key: 'eat', label: '食べる' },
  { key: 'living', label: '暮らし' },
  { key: 'move', label: '移動と旅' },
  { key: 'fun', label: '楽しむ' },
  { key: 'body', label: '体と身なり' },
  { key: 'other', label: 'そのほか' },
];

const GROUP_OF_ICON: Record<GenreIconKey, GenreGroupKey> = {
  grocery: 'eat',
  restaurant: 'eat',
  cafe: 'eat',
  bar: 'eat',
  goods: 'living',
  home: 'living',
  utility: 'living',
  phone: 'living',
  appliance: 'living',
  transport: 'move',
  travel: 'move',
  hobby: 'fun',
  book: 'fun',
  subscription: 'fun',
  gift: 'fun',
  health: 'body',
  beauty: 'body',
  fashion: 'body',
  money: 'other',
  kids: 'other',
  pet: 'other',
  other: 'other',
  uncategorized: 'other',
};

/** グループの中の並び(初めからあるカテゴリの順。足したカテゴリはそのあと)。 */
const ORDER = [
  '食料品',
  '外食',
  'カフェ・飲料',
  '酒',
  '日用品',
  '住居費',
  '光熱費',
  '通信費',
  '家電・家具',
  '交通・車両',
  '旅行',
  '娯楽・趣味',
  '書籍・学習',
  'サブスクリプション・会費',
  '交際費・贈答',
  '医療・健康',
  '美容',
  '衣服・ファッション',
  '保険・税金・手数料',
  'こども・教育',
  'ペット',
  'その他',
];

const SHORT: Record<string, string> = {
  'カフェ・飲料': 'カフェ',
  'サブスクリプション・会費': 'サブスク',
  '交際費・贈答': '交際費',
  '衣服・ファッション': '衣服',
  '保険・税金・手数料': '保険・税金',
  'こども・教育': 'こども',
};

/** アイコンの下で折れない長さ(12pt で4列のマスに収まる字数)。 */
export const SHORT_NAME_MAX = 5;

/** アイコンの下に出す短い名前。長い名前は「・」の前までを残す。 */
export function shortGenreName(name: string): string {
  const fixed = SHORT[name];
  if (fixed) return fixed;
  if (name.length <= SHORT_NAME_MAX) return name;
  const parts = name.split('・');
  while (parts.length > 1 && parts.join('・').length > SHORT_NAME_MAX) parts.pop();
  return parts.join('・');
}

export function genreGroupOf(name: string, override?: GenreStyleOverride | null): GenreGroupKey {
  return GROUP_OF_ICON[genreStyle(name, override).icon];
}

/** カテゴリをグループに分ける(空のグループは出さない)。 */
export function groupGenres<G extends { name: string }>(
  genres: readonly G[],
  overrideOf: (name: string) => GenreStyleOverride | null = () => null,
): { key: GenreGroupKey; label: string; genres: G[] }[] {
  const rank = (name: string) => {
    const i = ORDER.indexOf(name);
    return i === -1 ? ORDER.length : i;
  };
  return GENRE_GROUPS.map((group) => ({
    ...group,
    genres: genres
      .filter((g) => genreGroupOf(g.name, overrideOf(g.name)) === group.key)
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ja')),
  })).filter((group) => group.genres.length > 0);
}

/** 名前の一部で絞り込む(全角半角・ひらがなカタカナの違いを気にしない)。 */
export function matchesGenreQuery(name: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/\s/g, '');
  const q = norm(query);
  return q === '' || norm(name).includes(q) || norm(shortGenreName(name)).includes(q);
}
