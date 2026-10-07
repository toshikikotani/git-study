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
    note: '生成りの紙に、茶と深緑',
    colors: {
      plane: '#f4efe6',
      surface: '#fffaf3',
      ink: '#2a241c',
      accent: '#7a5c30',
      sub: '#2f6a4b',
    },
  },
  {
    id: 'ai',
    label: '藍',
    group: 'light',
    note: '藍染めと藍鼠',
    colors: {
      plane: '#e7eef6',
      surface: '#f7fbff',
      ink: '#102033',
      accent: '#1d4e89',
      sub: '#4b6f8f',
    },
  },
  {
    id: 'koke',
    label: '苔',
    group: 'light',
    note: '苔の緑と、枯れ草の金茶',
    colors: {
      plane: '#e7f0ea',
      surface: '#f6fbf7',
      ink: '#173026',
      accent: '#2f6f56',
      sub: '#8a7a3a',
    },
  },
  {
    id: 'sakura',
    label: '桜鼠',
    group: 'light',
    note: '灰みの桜と、藍鼠',
    colors: {
      plane: '#f5ecec',
      surface: '#fffafa',
      ink: '#3a282d',
      accent: '#9b4458',
      sub: '#5f7480',
    },
  },
  {
    id: 'matcha',
    label: '抹茶',
    group: 'light',
    note: '抹茶と、茶碗の土の色',
    colors: {
      plane: '#eff0e2',
      surface: '#fbfbf3',
      ink: '#262d18',
      accent: '#56661c',
      sub: '#9a6a3a',
    },
  },
  {
    id: 'dawn',
    label: '夜明け',
    group: 'light',
    note: 'Rosé Pine Dawn:松の青緑と薔薇',
    colors: {
      plane: '#faf4ed',
      surface: '#fffaf3',
      ink: '#464261',
      accent: '#286983',
      sub: '#b4637a',
    },
  },
  {
    id: 'snow',
    label: '北欧の雪',
    group: 'light',
    note: 'Nord:雪の白と、北極海の青',
    colors: {
      plane: '#e5e9f0',
      surface: '#f4f6f9',
      ink: '#2e3440',
      accent: '#4c6a92',
      sub: '#5a857a',
    },
  },
  {
    id: 'solarized',
    label: '陽だまり',
    group: 'light',
    note: 'Solarized Light:クリームに青と黄土',
    colors: {
      plane: '#eee8d5',
      surface: '#fdf6e3',
      ink: '#073642',
      accent: '#1a6398',
      sub: '#9a7500',
    },
  },
  {
    id: 'latte',
    label: 'ラテ',
    group: 'light',
    note: 'Catppuccin Latte:淡い灰に紫と青緑',
    colors: {
      plane: '#e6e9ef',
      surface: '#eff1f5',
      ink: '#4c4f69',
      accent: '#7a2fd8',
      sub: '#16808a',
    },
  },
  {
    id: 'morning-forest',
    label: '森の朝',
    group: 'light',
    note: 'Everforest Light:若葉と夕焼けの橙',
    colors: {
      plane: '#efebd4',
      surface: '#fdf6e3',
      ink: '#3f4b52',
      accent: '#4c6800',
      sub: '#c25a1c',
    },
  },
  {
    id: 'mocha-mousse',
    label: 'モカムース',
    group: 'light',
    note: 'Pantone 2025年の色 Mocha Mousse',
    colors: {
      plane: '#efe5de',
      surface: '#faf5f1',
      ink: '#3b2a22',
      accent: '#7a5442',
      sub: '#a47864',
    },
  },
  {
    id: 'cloud-dancer',
    label: 'クラウドダンサー',
    group: 'light',
    note: 'Pantone 2026年の色 Cloud Dancer に、石板とセージ',
    colors: {
      plane: '#f0eee9',
      surface: '#fbfaf7',
      ink: '#26262a',
      accent: '#3d4f5c',
      sub: '#6f8571',
    },
  },
  {
    id: 'terracotta',
    label: 'テラコッタ',
    group: 'light',
    note: '素焼きの赤茶と、反対色の青緑',
    colors: {
      plane: '#f6ebe4',
      surface: '#fffaf6',
      ink: '#3a2620',
      accent: '#a8462b',
      sub: '#3f6f6a',
    },
  },
  {
    id: 'lavender',
    label: 'ラベンダー',
    group: 'light',
    note: '藤の紫と、くすんだ薔薇',
    colors: {
      plane: '#eeecf6',
      surface: '#fbfaff',
      ink: '#2c2640',
      accent: '#6a4fb3',
      sub: '#a05a72',
    },
  },
  // ── 暗い ──
  {
    id: 'sumi',
    label: '墨',
    group: 'dark',
    note: '墨に、象牙と青磁',
    colors: {
      plane: '#121418',
      surface: '#1c2128',
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
      plane: '#181825',
      surface: '#1e1e2e',
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
      plane: '#1f1f28',
      surface: '#2a2a37',
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
