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

/** 利用者が選んだ見た目(genres.icon_key / color_index)。未設定の項目は名前からの既定。 */
export type GenreStyleOverride = { icon?: GenreIconKey | null; colorIndex?: number | null };

/** 選べるアイコン(未分類は選べない)。 */
export const SELECTABLE_ICONS: readonly GenreIconKey[] = [
  'grocery',
  'restaurant',
  'cafe',
  'bar',
  'goods',
  'fashion',
  'beauty',
  'health',
  'home',
  'utility',
  'phone',
  'transport',
  'hobby',
  'book',
  'subscription',
  'gift',
  'kids',
  'pet',
  'appliance',
  'travel',
  'money',
  'other',
];

export const ICON_LABELS: Record<GenreIconKey, string> = {
  grocery: '食料品',
  restaurant: '外食',
  cafe: 'カフェ',
  bar: 'お酒',
  goods: '日用品',
  fashion: '衣服',
  beauty: '美容',
  health: '医療',
  home: '住まい',
  utility: '光熱',
  phone: '通信',
  transport: '交通',
  hobby: '趣味',
  book: '本',
  subscription: '会費',
  gift: '贈り物',
  kids: 'こども',
  pet: 'ペット',
  appliance: '家電',
  travel: '旅行',
  money: 'お金',
  other: 'その他',
  uncategorized: '未分類',
};

/** ジャンル名から色とアイコンを決める。null は未分類。`override` は利用者が選んだ見た目。 */
export function genreStyle(name: string | null, override?: GenreStyleOverride | null): GenreStyle {
  if (name === null || name === '' || name === '未分類') {
    return { colorIndex: null, icon: 'uncategorized' };
  }
  const base = defaultGenreStyle(name);
  if (!override) return base;
  const colorIndex =
    override.colorIndex != null &&
    override.colorIndex >= 1 &&
    override.colorIndex <= GENRE_COLOR_COUNT
      ? override.colorIndex
      : base.colorIndex;
  return { colorIndex, icon: override.icon ?? base.icon };
}

function defaultGenreStyle(name: string): GenreStyle {
  const fixed = FIXED[name];
  if (fixed) return fixed;
  if (/収入|給与|給料|賞与/.test(name)) return { colorIndex: 1, icon: 'money' };
  return { colorIndex: (hash(name) % GENRE_COLOR_COUNT) + 1, icon: 'other' };
}

/** CSS の色。未分類は灰。 */
export function genreColorVar(name: string | null, override?: GenreStyleOverride | null): string {
  const { colorIndex } = genreStyle(name, override);
  return colorIndex === null ? 'var(--genre-none)' : `var(--genre-${colorIndex})`;
}

/**
 * 色の候補(app/globals.css の --genre-N の写し。テストで CSS と一致を確かめる)。
 * 背景 `surface` に対して、アイコンなどの図形に求められる 3:1(WCAG 1.4.11)を
 * 明るい・暗いの両方で満たす色だけを、設定の候補に出す。
 */
export const GENRE_COLOR_HEX = {
  light: [
    '#1f8f5f',
    '#c26a1b',
    '#8a5a3c',
    '#8e4fc4',
    '#0f8f9c',
    '#c2478f',
    '#6b8f1f',
    '#3d7f6b',
    '#7a5ca8',
    '#b5583a',
  ],
  dark: [
    '#3ec48a',
    '#f0994a',
    '#c99672',
    '#b985ee',
    '#3cc0cf',
    '#ee73b8',
    '#a3c94a',
    '#62b9a0',
    '#a68bd6',
    '#e88a6a',
  ],
  surface: { light: '#ffffff', dark: '#121826' },
} as const;

export const MIN_GRAPHIC_CONTRAST = 3;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 設定で選べる色の番号(1〜10)。明るい・暗いの両方でコントラストを満たすものだけ。 */
export function selectableColorIndexes(): number[] {
  const out: number[] = [];
  for (let i = 0; i < GENRE_COLOR_COUNT; i += 1) {
    const ok =
      contrastRatio(GENRE_COLOR_HEX.light[i]!, GENRE_COLOR_HEX.surface.light) >=
        MIN_GRAPHIC_CONTRAST &&
      contrastRatio(GENRE_COLOR_HEX.dark[i]!, GENRE_COLOR_HEX.surface.dark) >= MIN_GRAPHIC_CONTRAST;
    if (ok) out.push(i + 1);
  }
  return out;
}

/**
 * バー(比率・内訳)用の色。ジャンルの色を少し落ち着かせる(灰に寄せる)。
 * アイコンや文字の色は今の彩度のまま、面積の大きいバーだけを静かにする。
 */
const FAMILIES: { pastel: string; vivid: string }[] = [
  { pastel: '#9ed9c4', vivid: '#2f9a78' },
  { pastel: '#a9d7f2', vivid: '#3a90c8' },
  { pastel: '#f0d09a', vivid: '#c49218' },
  { pastel: '#d8c6f2', vivid: '#8a4ec4' },
  { pastel: '#f6c4b4', vivid: '#e07050' },
  { pastel: '#f4b4c8', vivid: '#d05080' },
  { pastel: '#b7d4b0', vivid: '#5a9a48' },
  { pastel: '#f0b0a8', vivid: '#d05040' },
  { pastel: '#b7c6f0', vivid: '#4a68c0' },
  { pastel: '#ead7a4', vivid: '#c4a020' },
  { pastel: '#9ecfc8', vivid: '#1f8f8a' },
  { pastel: '#e8c4a8', vivid: '#c07040' },
];
const FAMILY_OF: Record<string, number> = {
  食料品: 3,
  外食: 2,
  'カフェ・飲料': 5,
  酒: 9,
  日用品: 4,
  '衣服・ファッション': 6,
  美容: 7,
  '医療・健康': 10,
  住居費: 8,
  光熱費: 11,
  通信費: 10,
  '交通・車両': 1,
  '娯楽・趣味': 0,
  '書籍・学習': 8,
  'サブスクリプション・会費': 11,
  '交際費・贈答': 7,
  'こども・教育': 6,
  ペット: 0,
  '家電・家具': 9,
  旅行: 8,
  '保険・税金・手数料': 7,
  その他: 11,
};

function familyIndex(name: string): number {
  if (name in FAMILY_OF) return FAMILY_OF[name]!;
  const used = new Set(Object.values(FAMILY_OF));
  const free = FAMILIES.map((_, i) => i).filter((i) => !used.has(i));
  const pool = free.length > 0 ? free : FAMILIES.map((_, i) => i);
  return pool[hash(name) % pool.length]!;
}

/** アイコンも帯も同じ色。系統は一通り使うまで重ねない。明るい画面は淡く、暗い画面は濃く。 */
export function genreSwatchHex(name: string | null): string {
  if (name === null || name === '' || name === '未分類') return '#9aa3b2';
  return FAMILIES[familyIndex(name)]!.pastel;
}

export function genreSwatch(name: string | null): string {
  if (name === null || name === '' || name === '未分類') return 'var(--ink-muted)';
  const family = FAMILIES[familyIndex(name)]!;
  return `light-dark(color-mix(in srgb, ${family.pastel} var(--genre-mix, 100%), var(--genre-shade, #ffffff)), color-mix(in srgb, ${family.vivid} 78%, #111111))`;
}

export function genreBarColor(name: string | null, _override?: GenreStyleOverride | null): string {
  return genreSwatch(name);
}
