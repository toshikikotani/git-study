/**
 * 色のテーマ(設定 › 色)。背景・カード・文字・強調・サブの5色から、画面で使う色の役割
 * (補足の文字・線・帯・影・強調の上の文字など)をまとめて作る(ADR-079)。
 *
 * どのプリセットも、文字のコントラストは WCAG 2.1 の AA(4.5:1)以上、グラフの色は 3:1 以上
 * (tests/color-presets.test.ts で全部の組み合わせを確かめる)。収入の緑・超過の赤・注意の黄は
 * 意味の色なので変えない。
 */

export const THEME_KEY = 'git-study-color-theme';

export type ThemeColors = {
  /** 画面の背景 */
  plane: string;
  /** カード */
  surface: string;
  /** 文字 */
  ink: string;
  /** 強調(リンク・選択中・主なボタン) */
  accent: string;
  /** サブの色(見込みの帯・余裕の印など、強調と並ぶ2つめの色)。無ければ強調と同じ。 */
  sub?: string;
};

export type ThemeGroup = 'light' | 'dark';

export type ThemeStyle = 'simple' | 'stylish' | 'cute' | 'cool' | 'adult';

export type ThemePreset = {
  id: string;
  label: string;
  group: ThemeGroup;
  style: ThemeStyle;
  /** 配色の出どころ(一言) */
  note: string;
  colors: ThemeColors;
};

export type ColorTheme =
  { id: 'system' } | { id: string; colors: ThemeColors; tokens?: Record<string, string> };

/**
 * 20のプリセット。日本の伝統色、よく使われている配色(Rosé Pine・Nord・Solarized・
 * Catppuccin・Everforest・Kanagawa)、Pantone のカラー・オブ・ザ・イヤーから選び、
 * 画面で読める濃さに整えた(調べた元と整え方は docs/decisions.md の ADR-079)。
 */
export const PRESETS: readonly ThemePreset[] = [
  // ── 明るい ──
  {
    id: 'kinari',
    label: '生成り',
    style: 'simple',
    group: 'light',
    note: '生成りの紙に、茶とセージ。類似色の組み合わせ',
    colors: {
      plane: '#fcfbf8',
      surface: '#ffffff',
      ink: '#312826',
      accent: '#8a6840',
      sub: '#5f7d62',
    },
  },
  {
    id: 'ai',
    label: '藍',
    style: 'stylish',
    group: 'light',
    note: '薄い藍に、藍と砂色。補色に近い組み合わせ',
    colors: {
      plane: '#fafcfd',
      surface: '#ffffff',
      ink: '#21283b',
      accent: '#245488',
      sub: '#8a6844',
    },
  },
  {
    id: 'koke',
    label: '苔',
    style: 'stylish',
    group: 'light',
    note: '苔の緑と金茶。隣接色の組み合わせ',
    colors: {
      plane: '#fafcfa',
      surface: '#ffffff',
      ink: '#212d2a',
      accent: '#2f7358',
      sub: '#a08a4a',
    },
  },
  {
    id: 'sakura',
    label: '桜鼠',
    style: 'stylish',
    group: 'light',
    note: '灰みの桜と、藍鼠。補色の組み合わせ',
    colors: {
      plane: '#fcfafa',
      surface: '#ffffff',
      ink: '#3d2a33',
      accent: '#9a4d60',
      sub: '#6d8794',
    },
  },
  {
    id: 'snow',
    label: '北欧の雪',
    style: 'simple',
    group: 'light',
    note: '雪の白に、青と若緑。隣接色の組み合わせ',
    colors: {
      plane: '#fafbfc',
      surface: '#ffffff',
      ink: '#313343',
      accent: '#3d5c86',
      sub: '#4f7d70',
    },
  },
  {
    id: 'solarized',
    label: '陽だまり',
    style: 'simple',
    group: 'light',
    note: 'クリームに、青と黄土。補色の組み合わせ',
    colors: {
      plane: '#fcfaf7',
      surface: '#ffffff',
      ink: '#273743',
      accent: '#245a88',
      sub: '#8a6a18',
    },
  },
  {
    id: 'latte',
    label: 'ラテ',
    style: 'stylish',
    group: 'light',
    note: '淡い灰に、藤と青緑。補色の組み合わせ',
    colors: {
      plane: '#fafafc',
      surface: '#ffffff',
      ink: '#393850',
      accent: '#7648c0',
      sub: '#3d8f98',
    },
  },
  {
    id: 'mocha-mousse',
    label: 'モカムース',
    style: 'stylish',
    group: 'light',
    note: 'モカに、セージ。類似色ではなく別の色を添える',
    colors: {
      plane: '#fcf9f8',
      surface: '#ffffff',
      ink: '#382b2a',
      accent: '#7a5846',
      sub: '#6d8a72',
    },
  },
  {
    id: 'cloud-dancer',
    label: 'クラウドダンサー',
    style: 'simple',
    group: 'light',
    note: '白い雲に、石板とセージ。寒色同士の組み合わせ',
    colors: {
      plane: '#fcfbfa',
      surface: '#ffffff',
      ink: '#2d2a33',
      accent: '#3e5462',
      sub: '#5f7c64',
    },
  },
  {
    id: 'terracotta',
    label: 'テラコッタ',
    style: 'stylish',
    group: 'light',
    note: 'テラコッタと青緑。補色の組み合わせ',
    colors: {
      plane: '#fdfaf8',
      surface: '#ffffff',
      ink: '#3a2727',
      accent: '#a84e38',
      sub: '#5d8a84',
    },
  },
  {
    id: 'lavender',
    label: 'ラベンダー',
    style: 'stylish',
    group: 'light',
    note: '藤と薔薇。類似色の組み合わせ',
    colors: {
      plane: '#fcfbfd',
      surface: '#ffffff',
      ink: '#312a43',
      accent: '#6e52b4',
      sub: '#b56d84',
    },
  },
  // ── 暗い ──
  {
    id: 'sumi',
    label: '墨',
    style: 'simple',
    group: 'dark',
    note: '墨に、象牙と青磁',
    colors: {
      plane: '#1a1e24',
      surface: '#2c3036',
      ink: '#f4f1ea',
      accent: '#d7c4a3',
      sub: '#8fb8a0',
    },
  },
  {
    id: 'day',
    label: '昼の白',
    style: 'simple',
    group: 'light',
    note: 'ブラウザの昼間。白地に墨と藍',
    colors: {
      plane: '#ffffff',
      surface: '#ffffff',
      ink: '#1b191f',
      accent: '#2f4f6f',
      sub: '#8a5a3c',
    },
  },
  {
    id: 'porcelain',
    label: '白磁',
    style: 'simple',
    group: 'light',
    note: '白磁に、藍と金',
    colors: {
      plane: '#fcfcfb',
      surface: '#ffffff',
      ink: '#262326',
      accent: '#2c5278',
      sub: '#a6843e',
    },
  },
  {
    id: 'coral',
    label: '珊瑚',
    style: 'stylish',
    group: 'light',
    note: '珊瑚と青緑。補色の組み合わせ',
    colors: {
      plane: '#fdfbfa',
      surface: '#ffffff',
      ink: '#332326',
      accent: '#a44c3e',
      sub: '#3f7d78',
    },
  },
  {
    id: 'linen',
    label: '亜麻',
    style: 'simple',
    group: 'light',
    note: '亜麻に、臙脂とオリーブ',
    colors: {
      plane: '#fcfaf8',
      surface: '#ffffff',
      ink: '#312a29',
      accent: '#8a3e4a',
      sub: '#6a7a38',
    },
  },
  {
    id: 'night',
    label: '夜の黒',
    style: 'simple',
    group: 'dark',
    note: 'ブラウザの夜間。黒地に象牙と青磁',
    colors: {
      plane: '#000000',
      surface: '#141414',
      ink: '#f4f1ea',
      accent: '#d7c4a3',
      sub: '#8fb8a0',
    },
  },
  {
    id: 'ebony',
    label: '黒檀',
    style: 'stylish',
    group: 'dark',
    note: '黒檀に、金と緑青',
    colors: {
      plane: '#14110e',
      surface: '#272421',
      ink: '#f3eadc',
      accent: '#e0c07a',
      sub: '#7dbaa4',
    },
  },
  {
    id: 'charcoal',
    label: '炭',
    style: 'simple',
    group: 'dark',
    note: '炭に、錆と若草',
    colors: {
      plane: '#161616',
      surface: '#292929',
      ink: '#f0f0ea',
      accent: '#e09878',
      sub: '#b0c888',
    },
  },
  {
    id: 'moonlight',
    label: '月下',
    style: 'stylish',
    group: 'dark',
    note: '月下に、銀と藤',
    colors: {
      plane: '#14161a',
      surface: '#27292c',
      ink: '#eef0f4',
      accent: '#d0d6e0',
      sub: '#c0a8d8',
    },
  },

  {
    id: 'strawberry',
    label: 'いちご',
    style: 'cute',
    group: 'light',
    note: 'クリームに、薄いいちご',
    colors: {
      plane: '#fff6f8',
      surface: '#ffffff',
      ink: '#1a1020',
      accent: '#f4b4c8',
      sub: '#f7d5e0',
    },
  },
  {
    id: 'candy',
    label: 'キャンディ',
    style: 'cute',
    group: 'light',
    note: '綿あめに、薄いミント',
    colors: {
      plane: '#fff5fb',
      surface: '#ffffff',
      ink: '#1a1020',
      accent: '#f3b6d8',
      sub: '#c8eadf',
    },
  },
  {
    id: 'peach',
    label: '桃',
    style: 'cute',
    group: 'light',
    note: '薄い桃に、空',
    colors: {
      plane: '#fff5f0',
      surface: '#ffffff',
      ink: '#1a1020',
      accent: '#f6c8b4',
      sub: '#c5e3f6',
    },
  },
  {
    id: 'lemon',
    label: 'レモン',
    style: 'cute',
    group: 'light',
    note: 'バタークリームに、薄い桜',
    colors: {
      plane: '#fff9e8',
      surface: '#fffefb',
      ink: '#1a1020',
      accent: '#f0d09a',
      sub: '#f6c4d4',
    },
  },
  {
    id: 'soda',
    label: 'ソーダ',
    style: 'cute',
    group: 'light',
    note: '薄い空に、桜',
    colors: {
      plane: '#f4fbff',
      surface: '#ffffff',
      ink: '#102028',
      accent: '#b7ddf4',
      sub: '#f6c4d6',
    },
  },
  {
    id: 'macaron',
    label: 'マカロン',
    style: 'cute',
    group: 'light',
    note: '薄い藤に、桃',
    colors: {
      plane: '#f8f4ff',
      surface: '#ffffff',
      ink: '#1a1028',
      accent: '#d8c6f2',
      sub: '#f8d0c0',
    },
  },
  {
    id: 'pudding',
    label: 'プリン',
    style: 'cute',
    group: 'light',
    note: 'カスタードに、薄いさくらんぼ',
    colors: {
      plane: '#fff8ee',
      surface: '#fffefb',
      ink: '#1a1020',
      accent: '#f0d4a8',
      sub: '#f6c0c8',
    },
  },
  {
    id: 'balloon',
    label: '風船',
    style: 'cute',
    group: 'light',
    note: '薄いピンクに、空',
    colors: {
      plane: '#fff5f8',
      surface: '#ffffff',
      ink: '#1a1020',
      accent: '#f6c0d2',
      sub: '#c5e4f6',
    },
  },
  {
    id: 'night-pop',
    label: '夜のポップ',
    style: 'cute',
    group: 'dark',
    note: '夜に、薄いピンクと藤',
    colors: {
      plane: '#241828',
      surface: '#322034',
      ink: '#ffeef6',
      accent: '#f0a8d0',
      sub: '#c8b0f0',
    },
  },
  {
    id: 'rabbit',
    label: 'うさぎ',
    style: 'cute',
    group: 'light',
    note: '白に、薄いピンクと藤',
    colors: {
      plane: '#fff7f9',
      surface: '#ffffff',
      ink: '#1a1020',
      accent: '#f6c8d8',
      sub: '#ddcef2',
    },
  },
  {
    id: 'steel',
    label: '鋼',
    style: 'cool',
    group: 'dark',
    note: '鋼に、赤',
    colors: {
      plane: '#121416',
      surface: '#252729',
      ink: '#e8eef2',
      accent: '#7aa8bc',
      sub: '#e05050',
    },
  },
  {
    id: 'carbon',
    label: 'カーボン',
    style: 'cool',
    group: 'dark',
    note: 'カーボンに、シアン',
    colors: {
      plane: '#0e1012',
      surface: '#212325',
      ink: '#e6f2f2',
      accent: '#5ec8d0',
      sub: '#d0d8dc',
    },
  },
  {
    id: 'midnight',
    label: '真夜中',
    style: 'cool',
    group: 'dark',
    note: '真夜中に、電光',
    colors: {
      plane: '#0c1020',
      surface: '#1f2332',
      ink: '#e8eeff',
      accent: '#6aa0ff',
      sub: '#f0c040',
    },
  },
  {
    id: 'blade',
    label: '刃',
    style: 'cool',
    group: 'dark',
    note: '黒に、銀',
    colors: {
      plane: '#101214',
      surface: '#232527',
      ink: '#f0f4f6',
      accent: '#c8d4dc',
      sub: '#7a98b0',
    },
  },
  {
    id: 'racer',
    label: 'レーサー',
    style: 'cool',
    group: 'dark',
    note: '黒に、赤と白',
    colors: {
      plane: '#120e0e',
      surface: '#252121',
      ink: '#f6eeee',
      accent: '#ff6a6a',
      sub: '#d8d8d8',
    },
  },
  {
    id: 'voltage',
    label: '電圧',
    style: 'cool',
    group: 'dark',
    note: '黒に、黄',
    colors: {
      plane: '#121208',
      surface: '#25251c',
      ink: '#f6f6e4',
      accent: '#c4b420',
      sub: '#d8d8c8',
    },
  },
  {
    id: 'abyss',
    label: '深淵',
    style: 'cool',
    group: 'dark',
    note: '深い藍に、金',
    colors: {
      plane: '#0c1420',
      surface: '#1f2732',
      ink: '#e8eef8',
      accent: '#7eb0ee',
      sub: '#e0c070',
    },
  },
  {
    id: 'ice',
    label: '氷',
    style: 'cool',
    group: 'dark',
    note: '炭に、氷',
    colors: {
      plane: '#12181c',
      surface: '#252a2e',
      ink: '#e8f4f6',
      accent: '#5eb0c0',
      sub: '#c8d8e0',
    },
  },
  {
    id: 'neon',
    label: 'ネオン',
    style: 'cool',
    group: 'dark',
    note: '夜に、マゼンタ',
    colors: {
      plane: '#140e18',
      surface: '#27212a',
      ink: '#f8e8f4',
      accent: '#e060c0',
      sub: '#60d0e0',
    },
  },
  {
    id: 'gale',
    label: '疾風',
    style: 'cool',
    group: 'dark',
    note: '墨に、青白',
    colors: {
      plane: '#101418',
      surface: '#23272a',
      ink: '#e8f0f4',
      accent: '#8ec0e0',
      sub: '#d8e4ec',
    },
  },

  {
    id: 'otona-rose',
    label: '薔薇煤',
    style: 'adult',
    group: 'light',
    note: 'サイトの01。煤けた薔薇と生成り',
    colors: {
      plane: '#f2ede4',
      surface: '#ffffff',
      ink: '#2e2624',
      accent: '#a6808e',
      sub: '#d9b4bb',
    },
  },
  {
    id: 'otona-girl',
    label: '乙女',
    style: 'adult',
    group: 'light',
    note: 'サイトの02。薄い薔薇と藤',
    colors: {
      plane: '#f2ebf0',
      surface: '#ffffff',
      ink: '#2a2028',
      accent: '#c49ab4',
      sub: '#bac2d9',
    },
  },
  {
    id: 'otona-resort',
    label: 'リゾート',
    style: 'adult',
    group: 'light',
    note: 'サイトの03。灰青とセージ',
    colors: {
      plane: '#e7e9e4',
      surface: '#ffffff',
      ink: '#40302a',
      accent: '#5a6e73',
      sub: '#77a69d',
    },
  },
  {
    id: 'otona-retro',
    label: '杏',
    style: 'adult',
    group: 'light',
    note: 'サイトの05。杏と珊瑚',
    colors: {
      plane: '#f2e7c4',
      surface: '#ffffff',
      ink: '#2e2422',
      accent: '#f28379',
      sub: '#a68f86',
    },
  },
  {
    id: 'otona-grace',
    label: '気品',
    style: 'adult',
    group: 'light',
    note: 'サイトの06。煤薔薇と生成り',
    colors: {
      plane: '#f2eceb',
      surface: '#ffffff',
      ink: '#593f55',
      accent: '#8c646e',
      sub: '#a68f93',
    },
  },
  {
    id: 'otona-heal',
    label: '癒し',
    style: 'adult',
    group: 'light',
    note: 'サイトの09。セージと薄い薔薇',
    colors: {
      plane: '#f2efeb',
      surface: '#ffffff',
      ink: '#2e2a28',
      accent: '#5da684',
      sub: '#f2b6b6',
    },
  },
  {
    id: 'otona-soft',
    label: '調和',
    style: 'adult',
    group: 'light',
    note: 'サイトの10。煤薔薇とミント',
    colors: {
      plane: '#f2dfeb',
      surface: '#ffffff',
      ink: '#242222',
      accent: '#bf808c',
      sub: '#51a696',
    },
  },
  {
    id: 'otona-modern',
    label: '知的',
    style: 'adult',
    group: 'light',
    note: 'サイトの11。煤薔薇と灰藤',
    colors: {
      plane: '#f2e4dc',
      surface: '#ffffff',
      ink: '#242024',
      accent: '#a67b7e',
      sub: '#9295a6',
    },
  },
  {
    id: 'otona-clay',
    label: '粘土',
    style: 'adult',
    group: 'light',
    note: 'サイトの13。粘土と煤珊瑚',
    colors: {
      plane: '#f2e8df',
      surface: '#ffffff',
      ink: '#593e3c',
      accent: '#bf665e',
      sub: '#d9a689',
    },
  },
  {
    id: 'otona-classic',
    label: '格式',
    style: 'adult',
    group: 'light',
    note: 'サイトの15。墨と砂',
    colors: {
      plane: '#e4deca',
      surface: '#ffffff',
      ink: '#2e3b40',
      accent: '#63524d',
      sub: '#9c8d71',
    },
  },
];

export const DEFAULT_CUSTOM: ThemeColors = {
  plane: '#f4efe6',
  surface: '#fffaf3',
  ink: '#2a241c',
  accent: '#7a5c30',
  sub: '#2f6a4b',
};

function rgbOf(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isDark(plane: string): boolean {
  const rgb = rgbOf(plane);
  if (rgb === null) return false;
  const [r, g, b] = rgb;
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

/** WCAG 2.1 の相対輝度とコントラスト比。 */
function luminance(hex: string): number {
  const rgb = rgbOf(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 色相をずらす。1つのテーマの中で、同じ色の濃淡ではない色を作る。 */
export function rotateHue(hex: string, degrees: number): string {
  const rgb = rgbOf(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  h = (h + degrees + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(h / 60);
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg] ?? [0, 0, 0];
  return `#${table
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** 1つのテーマで使う4色。主、添え、その薄い版。色相を飛ばすと差し色の寄せ集めになる。 */
export function themeHues(colors: ThemeColors): [string, string, string, string, string] {
  const accent = colors.accent;
  const sub = colors.sub ?? accent;
  return [
    accent,
    sub,
    mixHex(accent, '#ffffff', 0.55),
    mixHex(sub, '#ffffff', 0.55),
    rotateHue(accent, 42),
  ];
}

/** a を t、b を 1 − t の割合で混ぜる。 */
export function mixHex(a: string, b: string, t: number): string {
  const ra = rgbOf(a) ?? [0, 0, 0];
  const rb = rgbOf(b) ?? [0, 0, 0];
  return `#${ra
    .map((v, i) => Math.round(v * t + rb[i]! * (1 - t)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex) ?? [0, 0, 0];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 文字の色をカードの色へできるだけ寄せて、背景・カードのどちらの上でも target 以上の
 * コントラストが残る色(補足の文字・薄い文字)。
 */
function softenedInk(ink: string, plane: string, surface: string, target: number): string {
  for (let t = 0.5; t <= 1.0001; t += 0.02) {
    const c = mixHex(ink, surface, t);
    if (contrast(c, plane) >= target && contrast(c, surface) >= target) return c;
  }
  return ink;
}

/** テーマの5色から、画面で使う色の役割(CSS 変数)をまとめて作る。 */
export function themeTokens(colors: ThemeColors): Record<string, string> {
  const { plane, surface, ink, accent } = colors;
  const sub = colors.sub ?? accent;
  const dark = isDark(plane);
  const onAccent = contrast('#ffffff', accent) >= 4.5 ? '#ffffff' : dark ? plane : ink;
  const [hueA, hueB, hueC, hueD, hueE] = themeHues(colors);
  const genres = [
    hueA,
    hueB,
    hueC,
    hueD,
    mixHex(hueC, ink, 0.75),
    mixHex(hueD, ink, 0.72),
    mixHex(hueA, hueC, 0.5),
    mixHex(hueB, hueD, 0.5),
    mixHex(hueC, hueD, 0.45),
    mixHex(hueD, hueA, 0.4),
  ];
  return {
    '--plane': plane,
    '--surface': surface,
    '--surface-raised': surface,
    '--ink': ink,
    '--ink-secondary': softenedInk(ink, plane, surface, 6.4),
    '--ink-muted': softenedInk(ink, plane, surface, 5.4),
    '--hairline': rgba(ink, dark ? 0.14 : 0.1),
    '--accent': accent,
    '--action': accent,
    '--on-accent': onAccent,
    '--on-action': onAccent,
    '--accent-track': rgba(accent, dark ? 0.12 : 0.07),
    '--mark': hueE,
    '--state-ok': sub,
    '--state-ok-track': mixHex(sub, surface, dark ? 0.18 : 0.1),
    '--income': sub,
    '--income-track': mixHex(sub, surface, dark ? 0.18 : 0.08),
    '--over-track': mixHex('#b82b2b', surface, dark ? 0.2 : 0.08),
    '--attention-track': mixHex(accent, surface, dark ? 0.16 : 0.08),
    '--state-caution': accent,
    '--state-caution-track': mixHex(accent, surface, dark ? 0.16 : 0.08),
    '--state-over-track': mixHex('#b82b2b', surface, dark ? 0.2 : 0.08),
    '--state-none': softenedInk(ink, plane, surface, 5.4),
    '--state-none-track': mixHex(ink, surface, dark ? 0.2 : 0.08),
    '--genre-1': genres[0]!,
    '--genre-2': genres[1]!,
    '--genre-3': genres[2]!,
    '--genre-4': genres[3]!,
    '--genre-5': genres[4]!,
    '--genre-6': genres[5]!,
    '--genre-7': genres[6]!,
    '--genre-8': genres[7]!,
    '--genre-9': genres[8]!,
    '--genre-10': genres[9]!,
    '--genre-none': softenedInk(ink, plane, surface, 5.4),
    '--hero-glow': rgba(accent, dark ? 0.1 : 0.05),
    '--card-shadow': dark
      ? '0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -20px rgba(0, 0, 0, 0.6)'
      : `0 1px 2px ${rgba(ink, 0.06)}, 0 12px 32px -20px ${rgba(ink, 0.28)}`,
  };
}

/** テーマを外すときに消す変数(themeTokens が入れる全部)。 */
const TOKEN_NAMES = Object.keys(themeTokens(DEFAULT_CUSTOM));

export function applyColorTheme(theme: ColorTheme | null): void {
  const root = document.documentElement;
  if (theme === null || theme.id === 'system' || !('colors' in theme)) {
    root.removeAttribute('data-theme');
    for (const name of TOKEN_NAMES) root.style.removeProperty(name);
    return;
  }
  root.dataset.theme = isDark(theme.colors.plane) ? 'dark' : 'light';
  for (const [name, value] of Object.entries(themeTokens(theme.colors))) {
    root.style.setProperty(name, value);
  }
}

export function readColorTheme(): ColorTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { id: 'system' };
    const parsed = JSON.parse(raw) as ColorTheme;
    if (parsed.id === 'system') return parsed;
    if (!('colors' in parsed) || !parsed.colors) return { id: 'system' };
    return parsed;
  } catch {
    return { id: 'system' };
  }
}

/** 保存する。最初の描画で計算し直さなくて済むよう、色の役割(tokens)も一緒に保存する。 */
export function writeColorTheme(theme: ColorTheme): void {
  const stored =
    theme.id === 'system' || !('colors' in theme)
      ? theme
      : { ...theme, tokens: themeTokens(theme.colors) };
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(stored));
  } catch {
    // 保存できなくても、この画面の間は色を変える
  }
  applyColorTheme(theme);
}

/**
 * 最初の描画の前に色を当てる(ちらつき防止)。保存した tokens があればそのまま当て、
 * 古い保存(4色だけ)なら背景・カード・文字・強調だけを当てる。
 */
export const THEME_BOOT = `(function(){try{var raw=localStorage.getItem('${THEME_KEY}');if(!raw)return;var t=JSON.parse(raw);if(!t||t.id==='system'||!t.colors)return;var c=t.colors;var hex=(c.plane||'').replace('#','');var dark=false;if(hex.length===6){var r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);dark=(r*299+g*587+b*114)/1000<140;}var root=document.documentElement;root.dataset.theme=dark?'dark':'light';var k=t.tokens;if(k&&typeof k==='object'){for(var n in k){if(Object.prototype.hasOwnProperty.call(k,n)&&n.indexOf('--')===0)root.style.setProperty(n,String(k[n]));}return;}root.style.setProperty('--plane',c.plane);root.style.setProperty('--surface',c.surface);root.style.setProperty('--surface-raised',c.surface);root.style.setProperty('--ink',c.ink);root.style.setProperty('--accent',c.accent);root.style.setProperty('--action',c.accent);}catch(e){}})();`;

/**
 * 以前の保存(4色だけ・tokens なし)を、今のプリセットと色の役割に置き換える(アプリを開いたときに1回)。
 * プリセットを選んでいたなら、そのプリセットの今の色にそろえる。
 */
export function upgradeStoredTheme(): void {
  const theme = readColorTheme();
  if (theme.id === 'system' || !('colors' in theme)) return;
  const preset = PRESETS.find((p) => p.id === theme.id);
  const current = preset ? preset.colors : theme.colors;
  const upToDate =
    theme.tokens !== undefined &&
    JSON.stringify(theme.tokens) === JSON.stringify(themeTokens(current));
  if (upToDate) return;
  writeColorTheme({ id: theme.id, colors: current });
}
