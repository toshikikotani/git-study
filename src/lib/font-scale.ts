import { useSyncExternalStore } from 'react';

/**
 * 文字サイズの倍率(ルートの文字サイズ ÷ 16px)。iOS の「文字を大きく」(Dynamic Type)で
 * 1を超える。グラフのように px で組む部品が、文字の大きさに合わせて広がるために使う。
 * サーバー側の描画では 1。
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  window.addEventListener('focus', cb);
  document.addEventListener('visibilitychange', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('focus', cb);
    document.removeEventListener('visibilitychange', cb);
  };
}

function snapshot(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? Math.round((px / 16) * 100) / 100 : 1;
}

export function useFontScale(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 1);
}
