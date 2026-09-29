/**
 * 編集シートの高さ(半分 ⇄ 全画面)の切り替えの判断。ハンドルを上にスワイプすると全画面、
 * 全画面から下にスワイプすると半分、半分から大きく下へスワイプすると閉じる。
 * キーボードが入力欄を隠さないための余白の計算も、ここに置く(DOM に触れない)。
 */

export type SheetState = 'half' | 'full' | 'closed';

export const SHEET_SNAP_PX = 60;
export const SHEET_CLOSE_PX = 140;
export const SHEET_FLING = 0.6; // px/ms

/**
 * ドラッグの結果。dy は下向きが正(指が動いた量)、velocity は下向きが正(px/ms)。
 * 速く払った(fling)ときは、距離が足りなくても切り替える。
 */
export function nextSheetState(current: SheetState, dy: number, velocity = 0): SheetState {
  if (current === 'closed') return 'closed';
  const up = dy <= -SHEET_SNAP_PX || velocity <= -SHEET_FLING;
  const down = dy >= SHEET_SNAP_PX || velocity >= SHEET_FLING;
  if (current === 'half') {
    if (up) return 'full';
    if (dy >= SHEET_CLOSE_PX || velocity >= SHEET_FLING * 2) return 'closed';
    return 'half';
  }
  // full
  if (down) return 'half';
  return 'full';
}

/** ソフトウェアキーボードの高さ(画面の下から隠れている分)。 */
export function keyboardInset(input: {
  innerHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
}): number {
  return Math.max(0, Math.round(input.innerHeight - input.visualHeight - input.visualOffsetTop));
}

/** シートの高さ(dvh)。 */
export const SHEET_HEIGHT_DVH: Record<Exclude<SheetState, 'closed'>, number> = {
  half: 58,
  full: 94,
};
