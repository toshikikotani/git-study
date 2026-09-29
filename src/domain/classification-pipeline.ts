/**
 * 品目のジャンル分類パイプライン。次の順で最初に決まったものを採る:
 *
 *   1. 利用者のルール   (pinned=true。「この品目は必ずこのジャンル」)
 *   2. 個人の履歴       (店×品目 → その店での過去の選び方。無ければ品目だけの履歴)
 *   3. 品目辞書         (TULLY'S → カフェ・飲料 など。ジャンル名が利用者の一覧にあるときだけ)
 *   4. AI 推定          (上で決まらなかったものだけ。呼び出し側が渡す)
 *
 * 決定的な 1〜3 を先に当て、AI は残りだけに使う(呼び出し回数と誤分類を減らす)。
 * 利用者が直したジャンルは applyCorrection() で履歴へ即座に反映する。
 */

import { lookupItemDictionary } from '@/domain/classification-dictionary';
import { comparableKey } from '@/domain/store-name';

export type ClassificationSource = 'rule' | 'history' | 'dictionary' | 'ai' | 'store_type';

export type MemoryEntry = {
  genreId: string;
  /** 利用者が固定したルールか(false は履歴)。 */
  pinned: boolean;
  /** 同じ選び方をした回数。 */
  hits: number;
};

/** キー:`${店キー}|${品目キー}`。店キーが空('')は「どの店でも」。 */
export type ClassificationMemory = Map<string, MemoryEntry>;

export function memoryKey(storeName: string, itemName: string): string {
  return `${comparableKey(storeName)}|${comparableKey(itemName)}`;
}

/** 店ごとのルールの品目キー(「この店はすべて○○」)。comparableKey は記号を消すので固定の文字で持つ。 */
export const STORE_WIDE_ITEM = '*';

export type ClassifyContext = {
  memory: ClassificationMemory;
  /** ジャンル名 → id(利用者のジャンル一覧)。 */
  genreIdByName: ReadonlyMap<string, string>;
};

export type LineClassification = {
  genreId: string;
  source: ClassificationSource;
  /** 0〜1。ルール・履歴の繰り返しほど高い。 */
  confidence: number;
};

/** AI を呼ばずに決まる分は決め、決まらなければ null。 */
export function classifyLine(
  storeName: string,
  itemName: string,
  ctx: ClassifyContext,
): LineClassification | null {
  const exact = ctx.memory.get(memoryKey(storeName, itemName));
  const anyStore = ctx.memory.get(memoryKey('', itemName));
  // 店ごとのルール(この店はすべて○○):品目が「*」のとき。店×品目の指定のあとに当てる。
  const storeWide = ctx.memory.get(`${comparableKey(storeName)}|${STORE_WIDE_ITEM}`);

  // 1. 利用者のルール(店×品目、次に店ごと、次に品目だけ)
  for (const m of [exact, storeWide, anyStore]) {
    if (m?.pinned) return { genreId: m.genreId, source: 'rule', confidence: 1 };
  }
  // 2. 個人の履歴(その店での選び方を優先)
  for (const m of [exact, anyStore]) {
    if (m) {
      return {
        genreId: m.genreId,
        source: 'history',
        confidence: Math.min(0.7 + 0.1 * m.hits, 0.95),
      };
    }
  }
  // 3. 品目辞書
  const name = lookupItemDictionary(itemName) ?? lookupItemDictionary(storeName);
  if (name !== null) {
    const id = ctx.genreIdByName.get(name);
    if (id !== undefined) return { genreId: id, source: 'dictionary', confidence: 0.8 };
  }
  return null;
}

/**
 * 利用者が品目のジャンルを直した内容を履歴へ反映する(即座に、新しい Map を返す)。
 * 同じ店×品目で別のジャンルへ直したら、回数を1に戻して新しい選び方に切り替える。
 * pin=true で「ルール」として固定する(品目だけのルールは storeName を空にする)。
 */
export function applyCorrection(
  memory: ClassificationMemory,
  input: {
    storeName: string;
    itemName: string;
    genreId: string;
    pin?: boolean;
    anyStore?: boolean;
  },
): ClassificationMemory {
  const next = new Map(memory);
  const key = memoryKey(input.anyStore ? '' : input.storeName, input.itemName);
  const prev = next.get(key);
  const sameGenre = prev?.genreId === input.genreId;
  next.set(key, {
    genreId: input.genreId,
    pinned: input.pin ?? (sameGenre ? prev!.pinned : false),
    hits: sameGenre ? prev!.hits + 1 : 1,
  });
  return next;
}
