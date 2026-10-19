import { useSyncExternalStore } from 'react';

export type RecentPhoto = { id: string; file: File; url: string };
const EMPTY: RecentPhoto[] = [];
let photos: RecentPhoto[] = EMPTY;
const listeners = new Set<() => void>();

/** このタブで許可・撮影された画像だけ。端末の写真一覧や永続ストレージにはアクセスしない。 */
export function rememberPhotos(files: readonly File[]) {
  const next = [...photos];
  for (const file of files) {
    if (next.some((p) => p.file === file)) continue;
    next.unshift({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  const removed = next.splice(12);
  photos = next;
  removed.forEach((p) => URL.revokeObjectURL(p.url));
  listeners.forEach((listener) => listener());
}

export function useRecentPhotos() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => photos,
    () => EMPTY,
  );
}
