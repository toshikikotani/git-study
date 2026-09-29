/**
 * 品目辞書と、店の種類ごとの初期ジャンル。ジャンルは利用者が自由に増減できるため、
 * ここでは既定のジャンル名(features/genre/store.ts の DEFAULT_GENRE_NAMES)で書き、
 * 利用者のジャンル一覧に同名があるときだけ使う(無ければ次の段=AI 推定へ進む)。
 */

import { comparableKey, type StoreType } from '@/domain/store-name';

/** 店の種類 → 既定のジャンル名(品目が分類できなかったときの親の初期値)。 */
export const STORE_TYPE_GENRE: Record<StoreType, string | null> = {
  drugstore: '日用品',
  convenience: '食料品',
  supermarket: '食料品',
  cafe: 'カフェ・飲料',
  restaurant: '外食',
  fast_food: '外食',
  bar: '外食',
  bookstore: '書籍・学習',
  clothing: '衣服・ファッション',
  home_center: '日用品',
  electronics: '家電・家具',
  transport: '交通・車両',
  other: null,
};

type Entry = { keywords: string[]; genre: string };

/** 品目辞書。上にあるものが優先。キーワードは comparableKey の形(小文字・記号なし)。 */
const ITEM_DICTIONARY: Entry[] = [
  {
    genre: 'カフェ・飲料',
    keywords: [
      'tullys',
      'タリーズ',
      'スターバックス',
      'スタバ',
      'コーヒー',
      '珈琲',
      'ラテ',
      'カフェ',
      'カプチーノ',
      'エスプレッソ',
      'アメリカーノ',
      'フラペチーノ',
      'ティー',
      '紅茶',
      'ミルクティー',
      'ドリンク',
      'ジュース',
      'ペットボトル',
      'お茶',
      '緑茶',
      '炭酸',
    ],
  },
  {
    genre: '酒',
    keywords: [
      'ビール',
      'ハイボール',
      'チューハイ',
      'サワー',
      '日本酒',
      'ワイン',
      'ウイスキー',
      'ウィスキー',
      '焼酎',
      '酎ハイ',
    ],
  },
  {
    genre: '医療・健康',
    keywords: [
      'ロキソニン',
      'バファリン',
      'パブロン',
      '目薬',
      '絆創膏',
      'バンドエイド',
      'マスク',
      '風邪薬',
      '胃腸薬',
      '湿布',
      'サプリ',
      'ビタミン',
      '第2類',
      '第一類',
      '第3類',
    ],
  },
  {
    genre: '美容',
    keywords: [
      '化粧水',
      '乳液',
      '美容液',
      'ファンデ',
      'リップ',
      'マスカラ',
      'アイシャドウ',
      'シャンプー',
      'コンディショナー',
      'トリートメント',
      'ヘアオイル',
      '日焼け止め',
      'パック',
      'クレンジング',
    ],
  },
  {
    genre: '日用品',
    keywords: [
      'ティッシュ',
      'トイレットペーパー',
      '洗剤',
      '柔軟剤',
      'ハンドソープ',
      '歯ブラシ',
      '歯磨き',
      'スポンジ',
      'ゴミ袋',
      'ラップ',
      'ペーパータオル',
      '電池',
      '石鹸',
      '洗濯',
      '食器用',
    ],
  },
  {
    genre: '食料品',
    keywords: [
      'おにぎり',
      'パン',
      '弁当',
      'サラダ',
      '牛乳',
      '卵',
      '納豆',
      '豆腐',
      '米',
      '野菜',
      '肉',
      '魚',
      'ヨーグルト',
      'チーズ',
      'ハム',
      'カップ麺',
      'ラーメン',
      'お菓子',
      'チョコ',
      'ガム',
      'アイス',
      'スナック',
      '惣菜',
      'バナナ',
      'りんご',
      '冷凍',
    ],
  },
  { genre: '書籍・学習', keywords: ['文庫', '雑誌', 'コミック', 'ノート', 'ボールペン', '参考書'] },
];

/** 品目名から辞書でジャンル名を引く。当たらなければ null。 */
export function lookupItemDictionary(itemName: string): string | null {
  const key = comparableKey(itemName);
  if (key === '') return null;
  for (const entry of ITEM_DICTIONARY) {
    if (entry.keywords.some((k) => key.includes(comparableKey(k)))) return entry.genre;
  }
  return null;
}
