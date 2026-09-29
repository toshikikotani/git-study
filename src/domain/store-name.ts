/**
 * 店名の正規化(「ココカラファイン阪神大阪梅田駅店」→ 店名「ココカラファイン」、
 * 支店名「阪神大阪梅田駅店」)。
 *
 * 履歴(店×品目)のキーや重複検知が、支店ごとの表記ゆれで別の店になるのを防ぐ。
 * 判断は決定的に行い、AI を使わない:
 *   1. 既知のチェーン名の辞書(前方一致。長い名前を優先)
 *   2. 辞書に無ければ、空白・「 」区切りの末尾が「〜店」なら支店名とみなす
 * どちらにも当たらなければ、元の名前をそのまま店名にする(支店名なし)。
 */

export type StoreType =
  | 'drugstore'
  | 'convenience'
  | 'supermarket'
  | 'cafe'
  | 'restaurant'
  | 'fast_food'
  | 'bar'
  | 'bookstore'
  | 'clothing'
  | 'home_center'
  | 'electronics'
  | 'transport'
  | 'other';

type Chain = { name: string; aliases: string[]; type: StoreType };

/** 主なチェーン。別名(表記ゆれ)は NFKC・小文字化・記号除去後の形で書く。 */
const CHAINS: Chain[] = [
  { name: 'ココカラファイン', aliases: ['ココカラファイン', 'cocokarafine'], type: 'drugstore' },
  { name: 'マツモトキヨシ', aliases: ['マツモトキヨシ', 'マツキヨ'], type: 'drugstore' },
  { name: 'スギ薬局', aliases: ['スギ薬局', 'スギドラッグ'], type: 'drugstore' },
  { name: 'ウエルシア', aliases: ['ウエルシア'], type: 'drugstore' },
  { name: 'ツルハドラッグ', aliases: ['ツルハドラッグ', 'ツルハ'], type: 'drugstore' },
  { name: 'サンドラッグ', aliases: ['サンドラッグ'], type: 'drugstore' },
  {
    name: 'セブン-イレブン',
    aliases: ['セブンイレブン', 'seveneleven', 'セブン'],
    type: 'convenience',
  },
  { name: 'ローソン', aliases: ['ローソン', 'lawson'], type: 'convenience' },
  {
    name: 'ファミリーマート',
    aliases: ['ファミリーマート', 'ファミマ', 'familymart'],
    type: 'convenience',
  },
  { name: 'ミニストップ', aliases: ['ミニストップ'], type: 'convenience' },
  { name: 'イオン', aliases: ['イオンスタイル', 'イオン'], type: 'supermarket' },
  { name: 'ライフ', aliases: ['ライフ'], type: 'supermarket' },
  { name: '西友', aliases: ['西友'], type: 'supermarket' },
  { name: 'まいばすけっと', aliases: ['まいばすけっと'], type: 'supermarket' },
  { name: 'ライフコーポレーション', aliases: ['ライフコーポレーション'], type: 'supermarket' },
  {
    name: 'スターバックス',
    aliases: ['スターバックスコーヒー', 'スターバックス', 'starbucks'],
    type: 'cafe',
  },
  {
    name: "TULLY'S COFFEE",
    aliases: ['tullyscoffee', 'tullys', 'タリーズコーヒー', 'タリーズ'],
    type: 'cafe',
  },
  {
    name: 'ドトールコーヒー',
    aliases: ['ドトールコーヒーショップ', 'ドトールコーヒー', 'ドトール'],
    type: 'cafe',
  },
  { name: 'コメダ珈琲店', aliases: ['コメダ珈琲店', 'コメダ珈琲'], type: 'cafe' },
  { name: 'マクドナルド', aliases: ['マクドナルド', 'mcdonalds'], type: 'fast_food' },
  { name: 'モスバーガー', aliases: ['モスバーガー'], type: 'fast_food' },
  { name: '吉野家', aliases: ['吉野家'], type: 'fast_food' },
  { name: 'すき家', aliases: ['すき家'], type: 'fast_food' },
  { name: '松屋', aliases: ['松屋'], type: 'fast_food' },
  { name: 'サイゼリヤ', aliases: ['サイゼリヤ'], type: 'restaurant' },
  { name: 'ガスト', aliases: ['ガスト'], type: 'restaurant' },
  { name: '紀伊國屋書店', aliases: ['紀伊國屋書店', '紀伊国屋書店'], type: 'bookstore' },
  { name: 'ユニクロ', aliases: ['ユニクロ', 'uniqlo'], type: 'clothing' },
  { name: 'ダイソー', aliases: ['ダイソー'], type: 'home_center' },
  { name: 'ヨドバシカメラ', aliases: ['ヨドバシカメラ', 'ヨドバシ'], type: 'electronics' },
  { name: 'ビックカメラ', aliases: ['ビックカメラ'], type: 'electronics' },
];

/** 比較用の形:NFKC・小文字・空白と記号(ハイフン・中黒・アポストロフィ等)を除く。 */
export function comparableKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　\-‐‑–—ー・･'’`´.,、。()（）「」『』・*＊]/g, (c) => (c === 'ー' ? 'ー' : ''));
}

export type NormalizedStore = {
  /** 正規化した店名(履歴のキー・一覧の1行目)。 */
  name: string;
  /** 支店名。無ければ null。 */
  branch: string | null;
  type: StoreType;
};

/** 元の表記の先頭から、比較用の形が alias に一致するぶんの文字数を返す(一致しなければ -1)。 */
function matchPrefixLength(original: string, aliasKey: string): number {
  let key = '';
  for (let i = 0; i < original.length; i += 1) {
    key = comparableKey(original.slice(0, i + 1));
    if (key === aliasKey) return i + 1;
    if (key.length > aliasKey.length || !aliasKey.startsWith(key)) return -1;
  }
  return -1;
}

export function normalizeStoreName(raw: string): NormalizedStore {
  const cleaned = raw
    .normalize('NFKC')
    .replace(/^(株式会社|\(株\)|㈱)\s*/, '')
    .trim();
  if (cleaned === '') return { name: '', branch: null, type: 'other' };

  // 1. チェーン辞書(別名が長いものを優先)。
  const candidates = CHAINS.flatMap((c) =>
    c.aliases.map((a) => ({ chain: c, key: comparableKey(a) })),
  ).sort((a, b) => b.key.length - a.key.length);
  for (const { chain, key } of candidates) {
    const len = matchPrefixLength(cleaned, key);
    if (len < 0) continue;
    const rest = cleaned
      .slice(len)
      .replace(/^[\s　\-・/／]+/, '')
      .trim();
    return { name: chain.name, branch: rest === '' ? null : rest, type: chain.type };
  }

  // 2. 空白区切りの末尾が「〜店」なら支店名。
  const parts = cleaned.split(/[\s　]+/);
  if (parts.length >= 2 && /店$/.test(parts[parts.length - 1]!)) {
    return {
      name: parts.slice(0, -1).join(' '),
      branch: parts[parts.length - 1]!,
      type: guessStoreType(cleaned),
    };
  }
  return { name: cleaned, branch: null, type: guessStoreType(cleaned) };
}

/** 辞書に無い店名の、語からの店の種類の推定。 */
function guessStoreType(name: string): StoreType {
  if (/薬局|ドラッグ|調剤/.test(name)) return 'drugstore';
  if (/コンビニ/.test(name)) return 'convenience';
  if (/スーパー|マーケット|ストア|食品館|市場/.test(name)) return 'supermarket';
  if (/珈琲|コーヒー|カフェ|cafe|coffee/i.test(name)) return 'cafe';
  if (/食堂|レストラン|ラーメン|寿司|すし|焼肉|居酒屋|亭|屋$/.test(name)) return 'restaurant';
  if (/書店|ブックス|books/i.test(name)) return 'bookstore';
  if (/電鉄|鉄道|バス|タクシー|交通|メトロ|JR/.test(name)) return 'transport';
  return 'other';
}
