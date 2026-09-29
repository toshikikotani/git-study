/**
 * 未分類の明細に出す、ジャンルの予測(上位3件)。ボトムシートで1タップで確定できる。
 *
 * 根拠は次の順(前ほど強い):
 *   1. 同じ店の過去の選び方(その店で多く選んだジャンル)
 *   2. 品目辞書・店名の辞書(TULLY'S → カフェ・飲料 など。domain/classification-dictionary.ts)
 *   3. 店の種類の初期ジャンル(ドラッグストア → 日用品 など)
 *   4. よく使うジャンル(全体で多い順)
 * 決定的な計算だけで、通信も AI も使わない(その場で出せる)。
 */

import { STORE_TYPE_GENRE, lookupItemDictionary } from '@/domain/classification-dictionary';
import { comparableKey, normalizeStoreName } from '@/domain/store-name';

export type GenrePrediction = {
  genreId: string;
  genreName: string;
  reason: 'history' | 'dictionary' | 'store_type' | 'frequent';
  /**
   * 0〜1。同じ店で同じジャンルを選んだ回数が多いほど、辞書は0.9、店の種類は0.6、よく使うだけなら0.3。
   * 「すべて予測どおりに確定」は 0.9 以上のものだけを対象にする。
   */
  confidence: number;
};

/** count は同じ組み合わせの回数(まとめて渡すとき。省略は1回)。 */
export type GenreHistoryEntry = { storeName: string; genreId: string; count?: number };

/** この信頼度以上だけを、まとめて確定する。 */
export const CONFIDENT = 0.9;

export const PREDICTION_COUNT = 3;

function countBy<T extends { count?: number }>(
  items: readonly T[],
  key: (t: T) => string,
): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + (i.count ?? 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function predictGenres(input: {
  storeName: string;
  itemNames?: readonly string[];
  genres: readonly { id: string; name: string }[];
  history: readonly GenreHistoryEntry[];
}): GenrePrediction[] {
  const byId = new Map(input.genres.map((g) => [g.id, g.name]));
  const byName = new Map(input.genres.map((g) => [g.name, g.id]));
  const out: GenrePrediction[] = [];
  const add = (
    genreId: string | undefined,
    reason: GenrePrediction['reason'],
    confidence: number,
  ) => {
    if (genreId === undefined || !byId.has(genreId)) return;
    if (out.some((p) => p.genreId === genreId)) return;
    if (out.length >= PREDICTION_COUNT) return;
    out.push({ genreId, genreName: byId.get(genreId)!, reason, confidence });
  };

  const store = normalizeStoreName(input.storeName);
  const storeKey = comparableKey(store.name === '' ? input.storeName : store.name);

  // 1. 同じ店の履歴(多い順)
  const sameStore = input.history.filter(
    (h) => comparableKey(normalizeStoreName(h.storeName).name || h.storeName) === storeKey,
  );
  const storeCounts = countBy(sameStore, (h) => h.genreId);
  const storeTotal = storeCounts.reduce((a, [, n]) => a + n, 0);
  for (const [genreId, n] of storeCounts) {
    // 同じ店で同じジャンルをほぼ毎回選んでいるほど高い(回数が多いほど、上限0.95まで)。
    const pure = n / storeTotal >= 0.9;
    add(genreId, 'history', pure ? Math.min(Math.round((0.7 + 0.1 * n) * 100) / 100, 0.95) : 0.6);
  }

  // 2. 辞書(品目 → 店名)
  for (const name of [...(input.itemNames ?? []), input.storeName]) {
    const g = lookupItemDictionary(name);
    if (g !== null) add(byName.get(g), 'dictionary', 0.9);
  }

  // 3. 店の種類
  const typeGenre = STORE_TYPE_GENRE[store.type];
  if (typeGenre !== null) add(byName.get(typeGenre), 'store_type', 0.6);

  // 4. よく使うジャンル
  for (const [genreId] of countBy(input.history, (h) => h.genreId)) add(genreId, 'frequent', 0.3);
  // 履歴が無い利用者でも3件は出す(ジャンルの並び順で補う)。
  for (const g of input.genres) add(g.id, 'frequent', 0.3);

  return out;
}
