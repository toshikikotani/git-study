/**
 * スクロールの向きに応じた、ナビゲーション(タブバー)の縮み方(純粋関数)。
 * 下へスクロールすると縮み、上へスクロールすると元に戻る。一番上では必ず元の大きさ。
 * 小さな揺れ(threshold 未満)では切り替えない。
 */
export const CHROME_THRESHOLD_PX = 8;

export function nextChromeCompact(
  prev: boolean,
  y: number,
  lastY: number,
  threshold = CHROME_THRESHOLD_PX,
): boolean {
  if (y <= 0) return false;
  const dy = y - lastY;
  if (dy > threshold) return true;
  if (dy < -threshold) return false;
  return prev;
}
