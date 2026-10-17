/**
 * カテゴリ詳細の画面遷移まわりの小さな純粋関数。
 */

/** カテゴリ詳細の URL(月は家計簿の期間から引き継ぐ)。 */
export function categoryHref(
  genreKey: string,
  monthKey: string,
  options?: { period?: 'month' | 'goal'; returnTo?: string | undefined },
): string {
  const params = new URLSearchParams({ month: monthKey.slice(0, 7) });
  if (options?.period) params.set('period', options.period);
  if (options?.returnTo) params.set('returnTo', options.returnTo);
  return `/spending/category/${encodeURIComponent(genreKey)}?${params.toString()}`;
}

export function monthHref(
  genreKey: string,
  monthKey: string,
  options?: { period?: 'month' | 'goal'; returnTo?: string | undefined },
): string {
  return categoryHref(genreKey, monthKey, options);
}

/** 横スワイプの判定。距離が足りない・斜めに動いた(縦のスクロール)ときは null。 */
export const SWIPE_MIN_PX = 60;
export const SWIPE_MAX_SLOPE = 0.6;

export function classifyHorizontalSwipe(dx: number, dy: number): 'left' | 'right' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_SLOPE) return null;
  return dx > 0 ? 'right' : 'left';
}

/** 画面の左端からのスワイプで戻る(iOS のホーム画面アプリには戻るジェスチャーが無いため)。 */
export const EDGE_ZONE_PX = 24;
export const EDGE_BACK_PX = 90;

export function isEdgeBackSwipe(startX: number, dx: number, dy: number): boolean {
  return startX <= EDGE_ZONE_PX && dx >= EDGE_BACK_PX && Math.abs(dy) <= dx * SWIPE_MAX_SLOPE;
}
