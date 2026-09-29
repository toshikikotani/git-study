import { useSyncExternalStore } from 'react';

/**
 * VoiceOver が画面に入ったときに最初に読む要約。
 * 例:「外食、9月、合計12,279円、23件」(数字の意味を先に言わせず、名前・期間・合計・件数の順)。
 */
export function categoryVoiceOverLabel(input: {
  genreName: string;
  monthKey: string;
  totalYen: number;
  count: number;
}): string {
  const month = Number(input.monthKey.slice(5, 7));
  return `${input.genreName}、${month}月、合計${Math.abs(input.totalYen).toLocaleString('ja-JP')}円、${input.count}件`;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** 通信できるか。サーバー側の描画では true(オフラインは実機でだけ分かる)。 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
