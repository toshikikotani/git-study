/**
 * 「最もよく使う移動先」(行を右スワイプしたときの移動先、行に表示する)。
 *
 * 決め方:(1) これまでにこの端末でカテゴリを移した回数が最も多いジャンル(いまのカテゴリ以外)。
 * (2) 履歴が無ければ、明細の店の過去の分類から予測したジャンル(未分類の行)。(3) それも無ければ、
 * ジャンルの並び順で最初のもの。
 */

import { useSyncExternalStore } from 'react';

export type MoveCounts = Readonly<Record<string, number>>;

export const MOVE_COUNTS_KEY = 'category:move-counts';

export function pickQuickDestination(input: {
  counts: MoveCounts;
  genres: readonly { id: string; name: string }[];
  currentGenreId: string | null;
  /** 履歴が無いときの候補(予測)。 */
  predictedGenreId?: string | null;
}): { id: string; name: string } | null {
  const others = input.genres.filter((g) => g.id !== input.currentGenreId);
  if (others.length === 0) return null;
  const ranked = [...others].sort((a, b) => (input.counts[b.id] ?? 0) - (input.counts[a.id] ?? 0));
  if ((input.counts[ranked[0]!.id] ?? 0) > 0) return ranked[0]!;
  const predicted = others.find((g) => g.id === input.predictedGenreId);
  return predicted ?? others[0]!;
}

export function bumpCount(counts: MoveCounts, genreId: string, by = 1): MoveCounts {
  return { ...counts, [genreId]: (counts[genreId] ?? 0) + by };
}

// ---- localStorage(この端末だけ)---------------------------------------------------------

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: MoveCounts = {};
const EMPTY: MoveCounts = {};

function read(): MoveCounts {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MOVE_COUNTS_KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    cached =
      typeof parsed === 'object' && parsed !== null
        ? (Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).filter(
              (e): e is [string, number] => typeof e[1] === 'number',
            ),
          ) as MoveCounts)
        : {};
  } catch {
    cached = {};
  }
  return cached;
}

export function recordMove(genreId: string | null): void {
  if (genreId === null) return;
  try {
    window.localStorage.setItem(MOVE_COUNTS_KEY, JSON.stringify(bumpCount(read(), genreId)));
  } catch {
    // 記録できなくても、移動そのものは成功している
  }
  for (const l of listeners) l();
}

export function useMoveCounts(): MoveCounts {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      window.addEventListener('storage', l);
      return () => {
        listeners.delete(l);
        window.removeEventListener('storage', l);
      };
    },
    read,
    () => EMPTY,
  );
}
