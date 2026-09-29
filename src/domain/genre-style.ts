/**
 * ジャンルごとの色とアイコン(デザイントークン)。全画面で同じものを使う。
 *
 * 色は `--genre-1`〜`--genre-10`(app/globals.css)の10色から選ぶ。赤・青・黄・灰は
 * 状態色(超過/余裕/注意/予算なし)に予約してあるため、ジャンルの色には使わない。
 * 色だけで区別させず、必ずアイコンと名前を併記する(色覚多様性への配慮)。
 *
 * 既定のジャンル名は固定の対応、利用者が増やしたジャンルは名前から決定的に
 * 10色へ割り振る(同じ名前はいつでも同じ色・同じアイコン)。
 */

export const GENRE_COLOR_COUNT = 10;

export type GenreIconKey =
  | 'grocery'
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'goods'
  | 'fashion'
  | 'beauty'
  | 'health'
  | 'home'
  | 'utility'
  | 'phone'
  | 'transport'
  | 'hobby'
  | 'book'
  | 'subscription'
  | 'gift'
  | 'kids'
  | 'pet'
  | 'appliance'
  | 'travel'
  | 'money'
  | 'other'
  | 'uncategorized';

export type GenreStyle = {
  /** 1〜10。CSS 変数 `--genre-N`。未分類は null(灰のトークンを使う)。 */
  colorIndex: number | null;
  icon: GenreIconKey;
};

const FIXED: Record<string, GenreStyle> = {
  食料品: { colorIndex: 1, icon: 'grocery' },
  外食: { colorIndex: 2, icon: 'restaurant' },
  'カフェ・飲料': { colorIndex: 3, icon: 'cafe' },
  酒: { colorIndex: 4, icon: 'bar' },
  日用品: { colorIndex: 5, icon: 'goods' },
  '衣服・ファッション': { colorIndex: 6, icon: 'fashion' },
  美容: { colorIndex: 7, icon: 'beauty' },
  '医療・健康': { colorIndex: 8, icon: 'health' },
  住居費: { colorIndex: 9, icon: 'home' },
  光熱費: { colorIndex: 10, icon: 'utility' },
  通信費: { colorIndex: 1, icon: 'phone' },
  '交通・車両': { colorIndex: 2, icon: 'transport' },
  '娯楽・趣味': { colorIndex: 3, icon: 'hobby' },
  '書籍・学習': { colorIndex: 4, icon: 'book' },
  'サブスクリプション・会費': { colorIndex: 5, icon: 'subscription' },
  '交際費・贈答': { colorIndex: 6, icon: 'gift' },
  'こども・教育': { colorIndex: 7, icon: 'kids' },
  ペット: { colorIndex: 8, icon: 'pet' },
  '家電・家具': { colorIndex: 9, icon: 'appliance' },
  旅行: { colorIndex: 10, icon: 'travel' },
  '保険・税金・手数料': { colorIndex: 8, icon: 'money' },
  その他: { colorIndex: 9, icon: 'other' },
};

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

/** ジャンル名から色とアイコンを決める。null は未分類。 */
export function genreStyle(name: string | null): GenreStyle {
  if (name === null || name === '' || name === '未分類') {
    return { colorIndex: null, icon: 'uncategorized' };
  }
  const fixed = FIXED[name];
  if (fixed) return fixed;
  if (/収入|給与|給料|賞与/.test(name)) return { colorIndex: 1, icon: 'money' };
  return { colorIndex: (hash(name) % GENRE_COLOR_COUNT) + 1, icon: 'other' };
}

/** CSS の色。未分類は灰。 */
export function genreColorVar(name: string | null): string {
  const { colorIndex } = genreStyle(name);
  return colorIndex === null ? 'var(--genre-none)' : `var(--genre-${colorIndex})`;
}
