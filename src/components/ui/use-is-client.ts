import { useSyncExternalStore } from 'react';

/**
 * サーバー(document が無い)では false、クライアントでは true を返す。
 * `useEffect` + `setState` で切り替える一般的な書き方は、実質的に
 * 「マウント後に強制で1回再レンダーする」ための setState であり
 * react-hooks/set-state-in-effect(カスケードするレンダーを増やすため
 * 避けている、more-menu.tsx と同じ理由)に引っかかる。`useSyncExternalStore`
 * はサーバー用とクライアント用のスナップショットを別々に受け取れるため、
 * 同じ結果を effect を経由せず得られる。
 *
 * `createPortal(..., document.body)` を使うコンポーネント(more-menu.tsx・
 * app/(app)/layout.tsx のボトムナビ)が共通して必要とするため、ここに
 * 切り出してある。
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
