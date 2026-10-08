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

export type ThemePreset = {
  id: string;
  label: string;
  group: ThemeGroup;
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
    group: 'light',
    note: '生成りの紙に、茶とセージ。類似色の組み合わせ',
    colors: {
      plane: '#f6f1e8',
      surface: '#fffaf4',
      ink: '#3a3228',
      accent: '#8a6840',
      sub: '#5f7d62',
    },
  },
  {
    id: 'ai',
    label: '藍',
    group: 'light',
    note: '薄い藍に、藍と砂色。補色に近い組み合わせ',
    colors: {
      plane: '#eef3f8',
      surface: '#f8fbfe',
      ink: '#243246',
      accent: '#245488',
      sub: '#8a6844',
    },
  },
  {
    id: 'koke',
    label: '苔',
    group: 'light',
    note: '苔の緑と金茶。隣接色の組み合わせ',
    colors: {
      plane: '#eef4ef',
      surface: '#f7fbf8',
      ink: '#24382e',
      accent: '#2f7358',
      sub: '#a08a4a',
    },
  },
  {
    id: 'sakura',
    label: '桜鼠',
    group: 'light',
    note: '灰みの桜と、藍鼠。補色の組み合わせ',
    colors: {
      plane: '#f7f0f0',
      surface: '#fffafa',
      ink: '#4a343a',
      accent: '#9a4d60',
      sub: '#6d8794',
    },
  },
  {
    id: 'matcha',
    label: '抹茶',
    group: 'light',
    note: '抹茶と土色。分裂補色の組み合わせ',
    colors: {
      plane: '#f3f4e8',
      surface: '#fbfbf4',
      ink: '#343c24',
      accent: '#5c6c28',
      sub: '#b07a4a',
    },
  },
  {
    id: 'dawn',
    label: '夜明け',
    group: 'light',
    note: '夜明け。青緑と薔薇の補色に近い組み合わせ',
    colors: {
      plane: '#faf6f1',
      surface: '#fffaf6',
      ink: '#4a4764',
      accent: '#245e76',
      sub: '#a35d72',
    },
  },
  {
    id: 'snow',
    label: '北欧の雪',
    group: 'light',
    note: '雪の白に、青と若緑。隣接色の組み合わせ',
    colors: {
      plane: '#eef1f5',
      surface: '#f7f8fb',
      ink: '#3a4150',
      accent: '#3d5c86',
      sub: '#4f7d70',
    },
  },
  {
    id: 'solarized',
    label: '陽だまり',
    group: 'light',
    note: 'クリームに、青と黄土。補色の組み合わせ',
    colors: {
      plane: '#f3efe4',
      surface: '#fdf8ee',
      ink: '#2c4650',
      accent: '#245a88',
      sub: '#8a6a18',
    },
  },
  {
    id: 'latte',
    label: 'ラテ',
    group: 'light',
    note: '淡い灰に、藤と青緑。補色の組み合わせ',
    colors: {
      plane: '#eef0f4',
      surface: '#f6f7fa',
      ink: '#454862',
      accent: '#7648c0',
      sub: '#3d8f98',
    },
  },
  {
    id: 'morning-forest',
    label: '森の朝',
    group: 'light',
    note: '若葉と夕焼け。補色の組み合わせ',
    colors: {
      plane: '#f4f1e4',
      surface: '#fdf8ee',
      ink: '#3f4b52',
      accent: '#5a7420',
      sub: '#d07038',
    },
  },
  {
    id: 'mocha-mousse',
    label: 'モカムース',
    group: 'light',
    note: 'モカに、セージ。類似色ではなく別の色を添える',
    colors: {
      plane: '#f3ebe6',
      surface: '#fbf6f2',
      ink: '#43362e',
      accent: '#7a5846',
      sub: '#6d8a72',
    },
  },
  {
    id: 'cloud-dancer',
    label: 'クラウドダンサー',
    group: 'light',
    note: '白い雲に、石板とセージ。寒色同士の組み合わせ',
    colors: {
      plane: '#f3f2ee',
      surface: '#fbfaf7',
      ink: '#34343a',
      accent: '#3e5462',
      sub: '#5f7c64',
    },
  },
  {
    id: 'terracotta',
    label: 'テラコッタ',
    group: 'light',
    note: 'テラコッタと青緑。補色の組み合わせ',
    colors: {
      plane: '#f8efe9',
      surface: '#fffaf7',
      ink: '#46302a',
      accent: '#a84e38',
      sub: '#5d8a84',
    },
  },
  {
    id: 'lavender',
    label: 'ラベンダー',
    group: 'light',
    note: '藤と薔薇。類似色の組み合わせ',
    colors: {
      plane: '#f3f1f8',
      surface: '#fbfaff',
      ink: '#3a3450',
      accent: '#6e52b4',
      sub: '#b56d84',
    },
  },
  // ── 暗い ──
  {
    id: 'sumi',
    label: '墨',
    group: 'dark',
    note: '墨に、象牙と青磁',
    colors: {
      plane: '#1a1e24',
      surface: '#242a32',
      ink: '#f4f1ea',
      accent: '#d7c4a3',
      sub: '#8fb8a0',
    },
  },
  {
    id: 'polar-night',
    label: '極夜',
    group: 'dark',
    note: 'Nord:極夜の紺に、氷の青とオーロラの緑',
    colors: {
      plane: '#2e3440',
      surface: '#3b4252',
      ink: '#eceff4',
      accent: '#88c0d0',
      sub: '#a3be8c',
    },
  },
  {
    id: 'moon',
    label: '月夜',
    group: 'dark',
    note: 'Rosé Pine Moon:夜の紫に、菖蒲と泡の青',
    colors: {
      plane: '#232136',
      surface: '#2a273f',
      ink: '#e0def4',
      accent: '#c4a7e7',
      sub: '#9ccfd8',
    },
  },
  {
    id: 'mocha',
    label: 'モカ',
    group: 'dark',
    note: 'Catppuccin Mocha:深い紺に、藤と若草',
    colors: {
      plane: '#222233',
      surface: '#2a2a3c',
      ink: '#cdd6f4',
      accent: '#cba6f7',
      sub: '#a6e3a1',
    },
  },
  {
    id: 'kanagawa',
    label: '浪裏',
    group: 'dark',
    note: 'Kanagawa:北斎の神奈川沖浪裏の藍と砂',
    colors: {
      plane: '#262630',
      surface: '#31313f',
      ink: '#dcd7ba',
      accent: '#7e9cd8',
      sub: '#e6c384',
    },
  },
  {
    id: 'night-forest',
    label: '森の夜',
    group: 'dark',
    note: 'Everforest Dark:夜の森に、苔と灯り',
    colors: {
      plane: '#2d353b',
      surface: '#343f44',
      ink: '#d3c6aa',
      accent: '#a7c080',
      sub: '#dbbc7f',
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
  const [r, g, b] = rgb.map((v) => v / 255);
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

/** 1つのテーマで使う4色。強調、サブ、隣の色、向かいの色。 */
export function themeHues(colors: ThemeColors): [string, string, string, string] {
  const accent = colors.accent;
  const sub = colors.sub ?? rotateHue(accent, 150);
  return [accent, sub, rotateHue(accent, 32), rotateHue(sub, 168)];
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
  const [hueA, hueB, hueC, hueD] = themeHues(colors);
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
    '--ink-secondary': softenedInk(ink, plane, surface, 5.2),
    '--ink-muted': softenedInk(ink, plane, surface, 4.6),
    '--hairline': rgba(ink, dark ? 0.14 : 0.1),
    '--accent': accent,
    '--action': accent,
    '--on-accent': onAccent,
    '--on-action': onAccent,
    '--accent-track': rgba(accent, dark ? 0.18 : 0.12),
    '--state-ok': sub,
    '--state-ok-track': mixHex(sub, surface, dark ? 0.28 : 0.18),
    '--income': sub,
    '--income-track': mixHex(sub, surface, dark ? 0.28 : 0.16),
    '--over-track': mixHex('#b82b2b', surface, dark ? 0.3 : 0.14),
    '--attention-track': mixHex(accent, surface, dark ? 0.24 : 0.14),
    '--state-caution-track': mixHex(accent, surface, dark ? 0.24 : 0.14),
    '--state-over-track': mixHex('#b82b2b', surface, dark ? 0.3 : 0.14),
    '--state-none': softenedInk(ink, plane, surface, 4.6),
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
    '--genre-none': softenedInk(ink, plane, surface, 4.6),
    '--hero-glow': rgba(accent, dark ? 0.16 : 0.1),
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
