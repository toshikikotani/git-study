/**
 * 色のテーマ(設定 › 色)。背景・カード・文字・強調・サブの5色から、画面で使う色の役割
 * (補足の文字・線・帯・影・強調の上の文字など)をまとめて作る(ADR-079)。
 *
 * どのプリセットも、文字のコントラストは WCAG 2.1 の AA(4.5:1)以上
 * (tests/color-presets.test.ts で全部の組み合わせを確かめる)。収入の緑・超過の赤・注意の黄は
 * 意味の色なので、テーマでは変えず、明るい・暗いでだけ切り替える(SEMANTIC)。
 *
 * プリセットの値は「配色見本帳」(50色、アプリのカードの形で読めることを確かめたもの)から。
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
  /** 補足の文字。無ければ文字から作る。 */
  inkSub?: string;
  /** 強調の色で書く文字(リンクなど)。淡い強調の色でも読めるよう、別に持つ。無ければ強調と同じ。 */
  accentText?: string;
  /** 強調の塗りの上の文字(ボタンの文字)。無ければ白か文字の色を選ぶ。 */
  onAccent?: string;
  /** サブの色の線・文字(帯のふちなど)。淡いサブの色でも見えるよう、別に持つ。無ければサブと同じ。 */
  subLine?: string;
};

/** 意味の色(収入・超過・注意)。どのテーマでも同じで、明るい・暗いでだけ変える。 */
export const SEMANTIC = {
  light: {
    income: '#278445',
    incomeBg: '#dcf7e1',
    over: '#c13c36',
    overBg: '#fee9e6',
    caution: '#9c6306',
    cautionBg: '#ffebd5',
  },
  dark: {
    income: '#7cd591',
    incomeBg: '#1a3520',
    over: '#fea196',
    overBg: '#442320',
    caution: '#f3ae58',
    cautionBg: '#3e290f',
  },
} as const;

/** なくしたプリセットの id → 近い今のプリセット(選んでいた人の色を引き継ぐ)。 */
export const MIGRATED_PRESETS: Readonly<Record<string, string>> = {
  latte: 'ruri',
  coral: 'miru',
  racer: 'shiden',
  ice: 'copper',
  gale: 'mist',
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
  | { id: 'system' }
  | { id: string; colors: ThemeColors; tokens?: Record<string, string>; style?: ThemeStyle };

/**
 * 50のプリセット(シンプル・スタイリッシュ・キュート・クール・大人 を各10)。値は「配色見本帳」から。
 * 調べた元と整え方は docs/decisions.md の ADR-079・ADR-087。
 */
export const PRESETS: readonly ThemePreset[] = [
  // ── シンプル ──
  {
    id: 'kinari',
    label: '生成り',
    style: 'simple',
    group: 'light',
    note: '生成りの紙に、茶とセージ。あたたかい定番',
    colors: {
      plane: '#f7f6f3',
      surface: '#ffffff',
      ink: '#312826',
      inkSub: '#7a6f6d',
      accent: '#8a6840',
      accentText: '#8a6840',
      onAccent: '#ffffff',
      sub: '#5f7d62',
      subLine: '#5f7d62',
    },
  },
  {
    id: 'snow',
    label: '北欧の雪',
    style: 'simple',
    group: 'light',
    note: '雪の白に、青と若緑。すっきり静か',
    colors: {
      plane: '#f5f6f7',
      surface: '#ffffff',
      ink: '#313343',
      inkSub: '#6e7083',
      accent: '#56708a',
      accentText: '#56708a',
      onAccent: '#ffffff',
      sub: '#4f7d70',
      subLine: '#4f7d70',
    },
  },
  {
    id: 'solarized',
    label: '陽だまり',
    style: 'simple',
    group: 'light',
    note: 'クリームに、青緑と黄土。やわらかい日なた',
    colors: {
      plane: '#f7f5f2',
      surface: '#ffffff',
      ink: '#273743',
      inkSub: '#627481',
      accent: '#1f6f8b',
      accentText: '#1f6f8b',
      onAccent: '#ffffff',
      sub: '#867046',
      subLine: '#867046',
    },
  },
  {
    id: 'cloud-dancer',
    label: '雲',
    style: 'simple',
    group: 'light',
    note: '白い雲に、石板とセージ。くすんだ寒色',
    colors: {
      plane: '#f6f5f4',
      surface: '#ffffff',
      ink: '#2d2a33',
      inkSub: '#736f7a',
      accent: '#3e5462',
      accentText: '#3e5462',
      onAccent: '#ffffff',
      sub: '#5f7c64',
      subLine: '#5f7c64',
    },
  },
  {
    id: 'day',
    label: '白紙',
    style: 'simple',
    group: 'light',
    note: '真っ白な紙に、墨だけ。色を使わない',
    colors: {
      plane: '#f6f6f6',
      surface: '#ffffff',
      ink: '#1b191f',
      inkSub: '#737179',
      accent: '#1b191f',
      accentText: '#1b191f',
      onAccent: '#ffffff',
      sub: '#8a5a3c',
      subLine: '#8a5a3c',
    },
  },
  {
    id: 'porcelain',
    label: '白磁',
    style: 'simple',
    group: 'light',
    note: '白磁に、呉須の藍と金',
    colors: {
      plane: '#f6f6f5',
      surface: '#ffffff',
      ink: '#262326',
      inkSub: '#747074',
      accent: '#2a5fa0',
      accentText: '#2a5fa0',
      onAccent: '#ffffff',
      sub: '#9e8658',
      subLine: '#9e8658',
    },
  },
  {
    id: 'linen',
    label: '亜麻',
    style: 'simple',
    group: 'light',
    note: '亜麻に、葡萄色とオリーブ',
    colors: {
      plane: '#f7f5f3',
      surface: '#ffffff',
      ink: '#312a29',
      inkSub: '#786f6e',
      accent: '#873e58',
      accentText: '#873e58',
      onAccent: '#ffffff',
      sub: '#6a7a38',
      subLine: '#6a7a38',
    },
  },
  {
    id: 'sumi',
    label: '墨',
    style: 'simple',
    group: 'dark',
    note: '墨に、象牙と青磁。夜に静か',
    colors: {
      plane: '#1a1e24',
      surface: '#2c3036',
      ink: '#f4f1ea',
      inkSub: '#9f9c96',
      accent: '#d7c4a3',
      accentText: '#d7c4a3',
      onAccent: '#1a1e24',
      sub: '#8fb8a0',
      subLine: '#8fb8a0',
    },
  },
  {
    id: 'night',
    label: '漆黒',
    style: 'simple',
    group: 'dark',
    note: '真っ黒に、月白と象牙。有機ELで電池にやさしい',
    colors: {
      plane: '#000000',
      surface: '#1c1c1e',
      ink: '#f4f1ea',
      inkSub: '#8b8982',
      accent: '#a8c0e8',
      accentText: '#a8c0e8',
      onAccent: '#000000',
      sub: '#d7c4a3',
      subLine: '#d7c4a3',
    },
  },
  {
    id: 'charcoal',
    label: '炭',
    style: 'simple',
    group: 'dark',
    note: '炭に、若草と素焼き',
    colors: {
      plane: '#161616',
      surface: '#292929',
      ink: '#f0f0ea',
      inkSub: '#959590',
      accent: '#b0c888',
      accentText: '#b0c888',
      onAccent: '#161616',
      sub: '#e0a078',
      subLine: '#e0a078',
    },
  },
  // ── スタイリッシュ ──
  {
    id: 'ai',
    label: '藍',
    style: 'stylish',
    group: 'light',
    note: '藍染めに、砂色',
    colors: {
      plane: '#f4f6f7',
      surface: '#ffffff',
      ink: '#21283b',
      inkSub: '#697288',
      accent: '#24406e',
      accentText: '#24406e',
      onAccent: '#ffffff',
      sub: '#8a6844',
      subLine: '#8a6844',
    },
  },
  {
    id: 'koke',
    label: '苔',
    style: 'stylish',
    group: 'light',
    note: '苔むす庭に、青竹と金茶',
    colors: {
      plane: '#f4f6f4',
      surface: '#ffffff',
      ink: '#212d2a',
      inkSub: '#677572',
      accent: '#2a6e66',
      accentText: '#2a6e66',
      onAccent: '#ffffff',
      sub: '#a08a4a',
      subLine: '#a08a4a',
    },
  },
  {
    id: 'sakura',
    label: '桜鼠',
    style: 'stylish',
    group: 'light',
    note: '灰みの桜に、藍鼠',
    colors: {
      plane: '#f7f5f5',
      surface: '#ffffff',
      ink: '#3d2a33',
      inkSub: '#826c76',
      accent: '#984d67',
      accentText: '#984d67',
      onAccent: '#ffffff',
      sub: '#6d8794',
      subLine: '#6d8794',
    },
  },
  {
    id: 'ruri',
    label: '瑠璃',
    style: 'stylish',
    group: 'light',
    note: '瑠璃の深い青に、金',
    colors: {
      plane: '#f5f5f7',
      surface: '#ffffff',
      ink: '#252a40',
      inkSub: '#6b718b',
      accent: '#3d48b0',
      accentText: '#3d48b0',
      onAccent: '#ffffff',
      sub: '#a88c5f',
      subLine: '#a88c5f',
    },
  },
  {
    id: 'mocha-mousse',
    label: 'ココア',
    style: 'stylish',
    group: 'light',
    note: 'ココアに、くすんだ青',
    colors: {
      plane: '#f8f5f4',
      surface: '#ffffff',
      ink: '#382b2a',
      inkSub: '#7d6e6d',
      accent: '#7a5846',
      accentText: '#7a5846',
      onAccent: '#ffffff',
      sub: '#6a7f96',
      subLine: '#6a7f96',
    },
  },
  {
    id: 'terracotta',
    label: 'テラコッタ',
    style: 'stylish',
    group: 'light',
    note: '素焼きの赤土に、青緑',
    colors: {
      plane: '#f8f5f3',
      surface: '#ffffff',
      ink: '#3a2727',
      inkSub: '#826c6b',
      accent: '#985438',
      accentText: '#985438',
      onAccent: '#ffffff',
      sub: '#5d8a84',
      subLine: '#5d8a84',
    },
  },
  {
    id: 'lavender',
    label: 'ラベンダー',
    style: 'stylish',
    group: 'light',
    note: '藤と薔薇。やさしい紫',
    colors: {
      plane: '#f6f5f7',
      surface: '#ffffff',
      ink: '#312a43',
      inkSub: '#766e8b',
      accent: '#6e52b4',
      accentText: '#6e52b4',
      onAccent: '#ffffff',
      sub: '#b56d84',
      subLine: '#b56d84',
    },
  },
  {
    id: 'miru',
    label: '海松',
    style: 'stylish',
    group: 'light',
    note: '海松色のオリーブに、藤',
    colors: {
      plane: '#f5f6f1',
      surface: '#ffffff',
      ink: '#2a2e22',
      inkSub: '#6f7466',
      accent: '#5f6a2a',
      accentText: '#5f6a2a',
      onAccent: '#ffffff',
      sub: '#9a88b8',
      subLine: '#9a88b8',
    },
  },
  {
    id: 'ebony',
    label: '黒檀',
    style: 'stylish',
    group: 'dark',
    note: '黒檀に、金茶と緑青',
    colors: {
      plane: '#14110e',
      surface: '#272421',
      ink: '#f3eadc',
      inkSub: '#978f82',
      accent: '#d8b888',
      accentText: '#d8b888',
      onAccent: '#14110e',
      sub: '#7dbaa4',
      subLine: '#7dbaa4',
    },
  },
  {
    id: 'moonlight',
    label: '月下',
    style: 'stylish',
    group: 'dark',
    note: '月夜に、銀と藤',
    colors: {
      plane: '#14161a',
      surface: '#27292c',
      ink: '#eef0f4',
      inkSub: '#939599',
      accent: '#d0d6e0',
      accentText: '#d0d6e0',
      onAccent: '#14161a',
      sub: '#c0a8d8',
      subLine: '#c0a8d8',
    },
  },
  // ── キュート ──
  {
    id: 'strawberry',
    label: 'いちご',
    style: 'cute',
    group: 'light',
    note: 'ミルクに、いちご',
    colors: {
      plane: '#fdf3f4',
      surface: '#ffffff',
      ink: '#1a1020',
      inkSub: '#796d81',
      accent: '#d46d8c',
      accentText: '#b65473',
      onAccent: '#1a1020',
      sub: '#f7d5e0',
      subLine: '#a98a94',
    },
  },
  {
    id: 'candy',
    label: 'キャンディ',
    style: 'cute',
    group: 'light',
    note: '綿あめに、ミント',
    colors: {
      plane: '#fdf3f7',
      surface: '#ffffff',
      ink: '#1a1020',
      inkSub: '#796d81',
      accent: '#7ed6d9',
      accentText: '#218184',
      onAccent: '#1a1020',
      sub: '#f8b4c8',
      subLine: '#bf7f93',
    },
  },
  {
    id: 'peach',
    label: '桃',
    style: 'cute',
    group: 'light',
    note: '桃に、空色',
    colors: {
      plane: '#fdf4ef',
      surface: '#ffffff',
      ink: '#1a1020',
      inkSub: '#796d81',
      accent: '#f3b295',
      accentText: '#a1664b',
      onAccent: '#1a1020',
      sub: '#b5e1f7',
      subLine: '#6e98ac',
    },
  },
  {
    id: 'lemon',
    label: 'レモン',
    style: 'cute',
    group: 'light',
    note: 'レモンクリームに、藤と空',
    colors: {
      plane: '#f8f5e6',
      surface: '#fffefb',
      ink: '#1a1020',
      inkSub: '#796d81',
      accent: '#d9a6dc',
      accentText: '#936496',
      onAccent: '#1a1020',
      sub: '#9ccbe8',
      subLine: '#6a97b2',
    },
  },
  {
    id: 'soda',
    label: 'ソーダ',
    style: 'cute',
    group: 'light',
    note: 'ソーダ水に、藤',
    colors: {
      plane: '#eff7fb',
      surface: '#ffffff',
      ink: '#102028',
      inkSub: '#62747e',
      accent: '#7ec8ea',
      accentText: '#317d9d',
      onAccent: '#102028',
      sub: '#c8b4f0',
      subLine: '#9c89c2',
    },
  },
  {
    id: 'macaron',
    label: 'マカロン',
    style: 'cute',
    group: 'light',
    note: '藤のマカロンに、ミント',
    colors: {
      plane: '#f7f3ff',
      surface: '#ffffff',
      ink: '#1a1028',
      inkSub: '#786d8b',
      accent: '#9a6ec4',
      accentText: '#8c61b4',
      onAccent: '#1a1028',
      sub: '#6ccbb3',
      subLine: '#40a28b',
    },
  },
  {
    id: 'pudding',
    label: 'プリン',
    style: 'cute',
    group: 'light',
    note: 'カスタードに、カラメルと苺ミルク',
    colors: {
      plane: '#fbf4ea',
      surface: '#fffefb',
      ink: '#1a1020',
      inkSub: '#796d81',
      accent: '#c88d73',
      accentText: '#9e664d',
      onAccent: '#1a1020',
      sub: '#f4c0cc',
      subLine: '#b4838f',
    },
  },
  {
    id: 'balloon',
    label: '風船',
    style: 'cute',
    group: 'light',
    note: 'キウイに、ピンクの風船',
    colors: {
      plane: '#eef9f0',
      surface: '#ffffff',
      ink: '#102018',
      inkSub: '#64766c',
      accent: '#acc75c',
      accentText: '#677d09',
      onAccent: '#102018',
      sub: '#f08ab4',
      subLine: '#cf769b',
    },
  },
  {
    id: 'rabbit',
    label: 'うさぎ',
    style: 'cute',
    group: 'light',
    note: '白うさぎに、ミルクティーとミント',
    colors: {
      plane: '#f7f6f4',
      surface: '#ffffff',
      ink: '#201a18',
      inkSub: '#78706e',
      accent: '#a08a78',
      accentText: '#86715f',
      onAccent: '#201a18',
      sub: '#a8dcc4',
      subLine: '#6a9c86',
    },
  },
  {
    id: 'night-pop',
    label: '夜のポップ',
    style: 'cute',
    group: 'dark',
    note: '夜に、ネオンピンクと空色',
    colors: {
      plane: '#241828',
      surface: '#362438',
      ink: '#ffeef6',
      inkSub: '#a19299',
      accent: '#ff8ec4',
      accentText: '#ff8ec4',
      onAccent: '#241828',
      sub: '#7ed0ea',
      subLine: '#7ed0ea',
    },
  },
  // ── クール ──
  {
    id: 'steel',
    label: '鋼',
    style: 'cool',
    group: 'dark',
    note: '鋼に、青鈍と銀',
    colors: {
      plane: '#121416',
      surface: '#252729',
      ink: '#e8eef2',
      inkSub: '#8e9397',
      accent: '#7aa8bc',
      accentText: '#7aa8bc',
      onAccent: '#121416',
      sub: '#c8d4dc',
      subLine: '#c8d4dc',
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
      inkSub: '#869191',
      accent: '#5ec8d0',
      accentText: '#5ec8d0',
      onAccent: '#0e1012',
      sub: '#8890a0',
      subLine: '#8890a0',
    },
  },
  {
    id: 'midnight',
    label: '真夜中',
    style: 'cool',
    group: 'dark',
    note: '真夜中に、電光の青と紫',
    colors: {
      plane: '#0c1020',
      surface: '#1f2332',
      ink: '#e8eeff',
      inkSub: '#8a909f',
      accent: '#6aa0ff',
      accentText: '#6aa0ff',
      onAccent: '#0c1020',
      sub: '#b8a0ff',
      subLine: '#b8a0ff',
    },
  },
  {
    id: 'blade',
    label: '刃',
    style: 'cool',
    group: 'dark',
    note: '黒に、白銀。色を抑えた刃物',
    colors: {
      plane: '#101214',
      surface: '#232527',
      ink: '#f0f4f6',
      inkSub: '#8d9193',
      accent: '#e0e6ea',
      accentText: '#e0e6ea',
      onAccent: '#101214',
      sub: '#7a98b0',
      subLine: '#7a98b0',
    },
  },
  {
    id: 'shiden',
    label: '紫電',
    style: 'cool',
    group: 'dark',
    note: '黒に、紫の稲妻とシアン',
    colors: {
      plane: '#100e16',
      surface: '#232029',
      ink: '#f0ecf8',
      inkSub: '#8f8b96',
      accent: '#9a7aff',
      accentText: '#9a7aff',
      onAccent: '#100e16',
      sub: '#5ec8d0',
      subLine: '#5ec8d0',
    },
  },
  {
    id: 'voltage',
    label: '電圧',
    style: 'cool',
    group: 'dark',
    note: '黒に、蛍光ライム',
    colors: {
      plane: '#121208',
      surface: '#25251c',
      ink: '#f6f6e4',
      inkSub: '#919180',
      accent: '#b8e050',
      accentText: '#b8e050',
      onAccent: '#121208',
      sub: '#d8d8c8',
      subLine: '#d8d8c8',
    },
  },
  {
    id: 'abyss',
    label: '深淵',
    style: 'cool',
    group: 'dark',
    note: '深い藍に、青緑と砂金',
    colors: {
      plane: '#0c1420',
      surface: '#1f2732',
      ink: '#e8eef8',
      inkSub: '#8c929b',
      accent: '#4fc0b0',
      accentText: '#4fc0b0',
      onAccent: '#0c1420',
      sub: '#d8c8a0',
      subLine: '#d8c8a0',
    },
  },
  {
    id: 'copper',
    label: '銅',
    style: 'cool',
    group: 'dark',
    note: '黒に、銅と緑青',
    colors: {
      plane: '#141210',
      surface: '#27241f',
      ink: '#f4eee8',
      inkSub: '#95908a',
      accent: '#d4a084',
      accentText: '#d4a084',
      onAccent: '#141210',
      sub: '#6ab0b8',
      subLine: '#6ab0b8',
    },
  },
  {
    id: 'neon',
    label: 'ネオン',
    style: 'cool',
    group: 'dark',
    note: '夜の街に、マゼンタと水色',
    colors: {
      plane: '#140e18',
      surface: '#27212a',
      ink: '#f8e8f4',
      inkSub: '#998a95',
      accent: '#e060c0',
      accentText: '#e060c0',
      onAccent: '#140e18',
      sub: '#60d0e0',
      subLine: '#60d0e0',
    },
  },
  {
    id: 'mist',
    label: '夜霧',
    style: 'cool',
    group: 'dark',
    note: '夜霧に、緑灰と藤',
    colors: {
      plane: '#121516',
      surface: '#25282a',
      ink: '#ecf0ee',
      inkSub: '#919593',
      accent: '#a0b8b0',
      accentText: '#a0b8b0',
      onAccent: '#121516',
      sub: '#d8c8e0',
      subLine: '#d8c8e0',
    },
  },
  // ── 大人 ──
  {
    id: 'otona-rose',
    label: '薔薇',
    style: 'adult',
    group: 'light',
    note: 'くすんだ薔薇',
    colors: {
      plane: '#fdf3f3',
      surface: '#ffffff',
      ink: '#3a2a2c',
      inkSub: '#806d6f',
      accent: '#f4acb7',
      accentText: '#a3626d',
      onAccent: '#3a2a2c',
      sub: '#e8d6d7',
      subLine: '#9e8e8f',
    },
  },
  {
    id: 'otona-girl',
    label: '清涼',
    style: 'adult',
    group: 'light',
    note: '薄荷と水色の涼しさ',
    colors: {
      plane: '#f2f6f6',
      surface: '#ffffff',
      ink: '#243034',
      inkSub: '#677479',
      accent: '#adc0d4',
      accentText: '#657689',
      onAccent: '#243034',
      sub: '#c3dbc5',
      subLine: '#829884',
    },
  },
  {
    id: 'otona-resort',
    label: 'リゾート',
    style: 'adult',
    group: 'light',
    note: '白砂に、浅瀬の青緑',
    colors: {
      plane: '#f7f3f3',
      surface: '#ffffff',
      ink: '#2e3030',
      inkSub: '#707272',
      accent: '#8eb8b8',
      accentText: '#547c7c',
      onAccent: '#2e3030',
      sub: '#f0d4d4',
      subLine: '#a68c8c',
    },
  },
  {
    id: 'otona-heal',
    label: '癒し',
    style: 'adult',
    group: 'light',
    note: 'くすみ藤に、ローズ',
    colors: {
      plane: '#f6f5fa',
      surface: '#ffffff',
      ink: '#2a2836',
      inkSub: '#716f80',
      accent: '#9a92c0',
      accentText: '#766e9a',
      onAccent: '#2a2836',
      sub: '#d4a0a0',
      subLine: '#b78585',
    },
  },
  {
    id: 'otona-retro',
    label: 'レトロ',
    style: 'adult',
    group: 'light',
    note: '昭和の空と檸檬',
    colors: {
      plane: '#f7f4ef',
      surface: '#ffffff',
      ink: '#243038',
      inkSub: '#66747d',
      accent: '#759eba',
      accentText: '#507893',
      onAccent: '#243038',
      sub: '#c9b45a',
      subLine: '#a59033',
    },
  },
  {
    id: 'otona-grace',
    label: '気品',
    style: 'adult',
    group: 'light',
    note: 'モーヴと青磁',
    colors: {
      plane: '#f5eff2',
      surface: '#ffffff',
      ink: '#322830',
      inkSub: '#7a6e78',
      accent: '#8a6c77',
      accentText: '#8a6c77',
      onAccent: '#ffffff',
      sub: '#8eaeae',
      subLine: '#799898',
    },
  },
  {
    id: 'otona-modern',
    label: '知的',
    style: 'adult',
    group: 'light',
    note: 'グレージュに、紺',
    colors: {
      plane: '#f4f3f1',
      surface: '#ffffff',
      ink: '#2a2a2c',
      inkSub: '#717174',
      accent: '#6e6a64',
      accentText: '#6e6a64',
      onAccent: '#ffffff',
      sub: '#5a6a88',
      subLine: '#5a6a88',
    },
  },
  {
    id: 'otona-soft',
    label: '調和',
    style: 'adult',
    group: 'light',
    note: '杏と藤',
    colors: {
      plane: '#f8f3ef',
      surface: '#ffffff',
      ink: '#322830',
      inkSub: '#7a6e78',
      accent: '#d4b09e',
      accentText: '#8e6d5d',
      onAccent: '#322830',
      sub: '#d4c6e2',
      subLine: '#9a8ca7',
    },
  },
  {
    id: 'otona-clay',
    label: '粘土',
    style: 'adult',
    group: 'light',
    note: '砂とセージ',
    colors: {
      plane: '#f2f2ec',
      surface: '#ffffff',
      ink: '#2e342e',
      inkSub: '#6d746d',
      accent: '#bccfc5',
      accentText: '#67786f',
      onAccent: '#2e342e',
      sub: '#e2d5d5',
      subLine: '#9a8e8e',
    },
  },
  {
    id: 'otona-classic',
    label: '格式',
    style: 'adult',
    group: 'light',
    note: '江戸紫と真鍮',
    colors: {
      plane: '#f3f4f7',
      surface: '#ffffff',
      ink: '#2a2434',
      inkSub: '#756f82',
      accent: '#46335a',
      accentText: '#46335a',
      onAccent: '#ffffff',
      sub: '#bda980',
      subLine: '#a49068',
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

/**
 * 背景・カードのどちらの上でも target 以上のコントラストになるまで、色を文字の色へ少しずつ寄せる
 * (見本の色をできるだけ変えずに、読める濃さを保つ)。
 */
function ensureContrast(
  color: string,
  toward: string,
  backgrounds: readonly string[],
  target: number,
): string {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = t === 0 ? color : mixHex(toward, color, t);
    if (backgrounds.every((bg) => contrast(c, bg) >= target)) return c;
  }
  return toward;
}

/** ジャンル別だけは色相を分ける。明るいテーマは薄く、暗いテーマは濃く。 */
function genrePalette(dark: boolean): string[] {
  return dark
    ? [
        '#e06088',
        '#3ecf9a',
        '#4aa8e0',
        '#e0b040',
        '#b070e0',
        '#e07858',
        '#40c090',
        '#e060a0',
        '#5a88d8',
        '#d0b050',
      ]
    : [
        '#f4b4c8',
        '#9ed9c4',
        '#a9d7f2',
        '#f0d09a',
        '#d8c6f2',
        '#f6c4b4',
        '#b7e6d0',
        '#f6c0d4',
        '#c5dff6',
        '#ead7a4',
      ];
}

/**
 * テーマの色から、画面で使う色の役割(CSS 変数)をまとめて作る。
 * 強調・サブは「塗り」と「文字・線」を分ける(淡い色の塗りでも、文字と線は読める濃さにする)。
 */
export function themeTokens(colors: ThemeColors): Record<string, string> {
  const { plane, surface, ink, accent } = colors;
  const sub = colors.sub ?? accent;
  const dark = isDark(plane);
  const sem = dark ? SEMANTIC.dark : SEMANTIC.light;
  const readable = (color: string, track: string) =>
    ensureContrast(color, ink, [plane, surface, track], 4.5);
  const semantic = {
    ...sem,
    income: readable(sem.income, sem.incomeBg),
    over: readable(sem.over, sem.overBg),
    caution: readable(sem.caution, sem.cautionBg),
  };
  const accentText = colors.accentText
    ? ensureContrast(colors.accentText, ink, [plane, surface], 4.5)
    : accent;
  const subLine = colors.subLine ? ensureContrast(colors.subLine, ink, [plane, surface], 3) : sub;
  const onAction =
    colors.onAccent ?? (contrast('#ffffff', accent) >= 4.5 ? '#ffffff' : dark ? plane : ink);
  const onAccent = contrast('#ffffff', accentText) >= 4.5 ? '#ffffff' : dark ? plane : ink;
  const inkMuted = colors.inkSub
    ? ensureContrast(colors.inkSub, ink, [plane, surface], 4.5)
    : softenedInk(ink, plane, surface, 5.4);
  const inkSecondary = colors.inkSub
    ? mixHex(ink, inkMuted, 0.35)
    : softenedInk(ink, plane, surface, 6.4);
  const hueE = themeHues(colors)[4];

  return {
    '--plane': plane,
    '--surface': surface,
    '--surface-raised': surface,
    '--ink': ink,
    '--ink-secondary': inkSecondary,
    '--ink-muted': inkMuted,
    '--hairline': rgba(ink, dark ? 0.14 : 0.1),
    '--accent': accentText,
    '--action': accent,
    '--on-accent': onAccent,
    '--on-action': onAction,
    '--accent-track': rgba(accent, dark ? 0.16 : 0.1),
    '--mark': hueE,
    '--state-ok': subLine,
    '--state-ok-track': mixHex(sub, surface, dark ? 0.22 : 0.16),
    '--income': semantic.income,
    '--income-track': semantic.incomeBg,
    '--over': semantic.over,
    '--over-track': semantic.overBg,
    '--attention': semantic.caution,
    '--attention-track': semantic.cautionBg,
    '--state-caution': semantic.caution,
    '--state-caution-track': semantic.cautionBg,
    '--state-over': semantic.over,
    '--state-over-track': semantic.overBg,
    '--state-none': inkMuted,
    '--state-none-track': mixHex(ink, surface, dark ? 0.2 : 0.08),
    '--genre-1': genrePalette(dark)[0]!,
    '--genre-2': genrePalette(dark)[1]!,
    '--genre-3': genrePalette(dark)[2]!,
    '--genre-4': genrePalette(dark)[3]!,
    '--genre-5': genrePalette(dark)[4]!,
    '--genre-6': genrePalette(dark)[5]!,
    '--genre-7': genrePalette(dark)[6]!,
    '--genre-8': genrePalette(dark)[7]!,
    '--genre-9': genrePalette(dark)[8]!,
    '--genre-10': genrePalette(dark)[9]!,
    '--genre-none': inkMuted,
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
  const style = 'style' in theme ? theme.style : undefined;
  root.style.setProperty(
    '--genre-shade',
    style === 'stylish' || style === 'cool'
      ? '#1c1c1c'
      : style === 'adult'
        ? '#4a403c'
        : style === 'simple'
          ? '#2a2a2a'
          : '#ffffff',
  );
  root.style.setProperty(
    '--genre-mix',
    style === 'stylish' || style === 'cool'
      ? '62%'
      : style === 'adult'
        ? '74%'
        : style === 'simple'
          ? '78%'
          : '100%',
  );
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
  const preset = theme.id !== 'system' ? PRESETS.find((item) => item.id === theme.id) : undefined;
  const stored =
    theme.id === 'system' || !('colors' in theme)
      ? theme
      : { ...theme, style: theme.style ?? preset?.style, tokens: themeTokens(theme.colors) };
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
export const THEME_BOOT = `(function(){try{var raw=localStorage.getItem('${THEME_KEY}');if(!raw)return;var t=JSON.parse(raw);if(!t||t.id==='system'||!t.colors)return;var c=t.colors;var hex=(c.plane||'').replace('#','');var dark=false;if(hex.length===6){var r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);dark=(r*299+g*587+b*114)/1000<140;}var root=document.documentElement;root.dataset.theme=dark?'dark':'light';var k=t.tokens;if(k&&typeof k==='object'){for(var n in k){if(Object.prototype.hasOwnProperty.call(k,n)&&n.indexOf('--')===0)root.style.setProperty(n,String(k[n]));}}var s=t.style;root.style.setProperty('--genre-shade',s==='stylish'||s==='cool'?'#1c1c1c':s==='adult'?'#4a403c':s==='simple'?'#2a2a2a':'#ffffff');root.style.setProperty('--genre-mix',s==='stylish'||s==='cool'?'62%':s==='adult'?'74%':s==='simple'?'78%':'100%');if(k&&typeof k==='object')return;root.style.setProperty('--plane',c.plane);root.style.setProperty('--surface',c.surface);root.style.setProperty('--surface-raised',c.surface);root.style.setProperty('--ink',c.ink);root.style.setProperty('--accent',c.accent);root.style.setProperty('--action',c.accent);}catch(e){}})();`;

/**
 * 以前の保存(4色だけ・tokens なし)を、今のプリセットと色の役割に置き換える(アプリを開いたときに1回)。
 * プリセットを選んでいたなら、そのプリセットの今の色にそろえる(なくしたプリセットは近いものへ)。
 */
export function upgradeStoredTheme(): void {
  const theme = readColorTheme();
  if (theme.id === 'system' || !('colors' in theme)) return;
  const id = MIGRATED_PRESETS[theme.id] ?? theme.id;
  const preset = PRESETS.find((p) => p.id === id);
  const current = preset ? preset.colors : theme.colors;
  const upToDate =
    id === theme.id &&
    theme.tokens !== undefined &&
    JSON.stringify(theme.tokens) === JSON.stringify(themeTokens(current));
  if (upToDate) return;
  writeColorTheme({ id, colors: current });
}
