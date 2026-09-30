/**
 * クライアント側のオフライン検知(N1本人要件「オフライン時は代替表示にする」)。
 *
 * AIの一括オフ(settings.ts)はサーバー側で見る状態だが、オフラインかどうかは
 * ブラウザだけが知っている。AIを呼ぶ前にこれを見て、往復せずに代替表示へ
 * 直行できるようにする画面側のための小さなヘルパー。
 */
export function isOffline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}
