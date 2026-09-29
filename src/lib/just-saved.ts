import { useSyncExternalStore } from 'react';

/**
 * レシートを保存した直後、家計簿の画面で「追加された行」と「伸びるバー」を短く動かすための
 * 受け渡し(sessionStorage)。保存した明細の id を記録し、家計簿が一度だけ読んで消す。
 * 動きは補助で、保存できたかどうかの判断には使わない。
 */
const KEY = 'ledger:just-saved';

export function markJustSaved(ids: readonly string[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 保存できなくても動きが出ないだけ
  }
}

export function consumeJustSaved(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return [];
    window.sessionStorage.removeItem(KEY);
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const EMPTY: readonly string[] = [];
let current: readonly string[] = EMPTY;
let loaded = false;

const subscribe = () => () => {};

function getSnapshot(): readonly string[] {
  if (!loaded) {
    loaded = true;
    const got = consumeJustSaved();
    if (got.length > 0) {
      current = got;
      window.setTimeout(() => {
        current = EMPTY;
        loaded = false;
      }, 1500);
    } else {
      // 次にこの画面へ戻ったときにもう一度読めるよう、少し後で読み直しを許す。
      window.setTimeout(() => {
        loaded = false;
      }, 0);
    }
  }
  return current;
}

/**
 * 家計簿の画面が開いた直後に、直前に保存された明細の id を返す(1.5秒だけ)。
 * 同じ画面の複数の部品(行・バー)が同じ値を読めるよう、少しの間だけ保持する。
 */
export function useJustSaved(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
