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
};

export type GenreHistoryEntry = { storeName: string; genreId: string };

export const PREDICTION_COUNT = 3;

function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
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
  const add = (genreId: string | undefined, reason: GenrePrediction['reason']) => {
    if (genreId === undefined || !byId.has(genreId)) return;
    if (out.some((p) => p.genreId === genreId)) return;
    if (out.length >= PREDICTION_COUNT) return;
    out.push({ genreId, genreName: byId.get(genreId)!, reason });
  };

  const store = normalizeStoreName(input.storeName);
  const storeKey = comparableKey(store.name === '' ? input.storeName : store.name);

  // 1. 同じ店の履歴(多い順)
  const sameStore = input.history.filter(
    (h) => comparableKey(normalizeStoreName(h.storeName).name || h.storeName) === storeKey,
  );
  for (const [genreId] of countBy(sameStore, (h) => h.genreId)) add(genreId, 'history');

  // 2. 辞書(品目 → 店名)
  for (const name of [...(input.itemNames ?? []), input.storeName]) {
    const g = lookupItemDictionary(name);
    if (g !== null) add(byName.get(g), 'dictionary');
  }

  // 3. 店の種類
  const typeGenre = STORE_TYPE_GENRE[store.type];
  if (typeGenre !== null) add(byName.get(typeGenre), 'store_type');

  // 4. よく使うジャンル
  for (const [genreId] of countBy(input.history, (h) => h.genreId)) add(genreId, 'frequent');
  // 履歴が無い利用者でも3件は出す(ジャンルの並び順で補う)。
  for (const g of input.genres) add(g.id, 'frequent');

  return out;
}
