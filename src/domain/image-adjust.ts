/**
 * レシート画像の補正(回転・切り抜き・明るさ)の計算。描画は画面側(canvas)が行い、
 * ここは「どの範囲を切り出すか」「回転後の大きさ」を返す純粋関数。
 * 元の画像は変えない(補正済みは別の画像として保存する)。
 */

export type Rotation = 0 | 90 | 180 | 270;

/** 切り抜きの余白(0〜0.4、画像の各辺から内側へ何割削るか)。 */
export type CropInsets = { top: number; right: number; bottom: number; left: number };

export const NO_CROP: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 };
export const MAX_CROP_INSET = 0.4;

export function rotateBy(current: Rotation, delta: 90 | -90): Rotation {
  return ((((current + delta) % 360) + 360) % 360) as Rotation;
}

/** 余白を 0〜0.4 に丸め、向かい合う辺の合計が 0.8 を超えないようにする(画像が消えないように)。 */
export function clampInsets(insets: CropInsets): CropInsets {
  const c = (v: number) => Math.min(MAX_CROP_INSET, Math.max(0, Number.isFinite(v) ? v : 0));
  return {
    top: c(insets.top),
    right: c(insets.right),
    bottom: c(insets.bottom),
    left: c(insets.left),
  };
}

/** 回転後の画像の大きさ。 */
export function rotatedSize(
  width: number,
  height: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/** 回転後の画像から切り出す範囲(px、整数)。 */
export function cropRect(
  width: number,
  height: number,
  rotation: Rotation,
  insets: CropInsets,
): { x: number; y: number; width: number; height: number } {
  const size = rotatedSize(width, height, rotation);
  const i = clampInsets(insets);
  const x = Math.round(size.width * i.left);
  const y = Math.round(size.height * i.top);
  return {
    x,
    y,
    width: Math.max(1, Math.round(size.width * (1 - i.left - i.right))),
    height: Math.max(1, Math.round(size.height * (1 - i.top - i.bottom))),
  };
}

/** 明るさ(0.6〜1.6、1=そのまま)。 */
export function clampBrightness(value: number): number {
  return Math.min(1.6, Math.max(0.6, Number.isFinite(value) ? value : 1));
}

/** 何も補正していないか(保存の要否の判断)。 */
export function isUnadjusted(rotation: Rotation, insets: CropInsets, brightness: number): boolean {
  const i = clampInsets(insets);
  return (
    rotation === 0 &&
    i.top === 0 &&
    i.right === 0 &&
    i.bottom === 0 &&
    i.left === 0 &&
    clampBrightness(brightness) === 1
  );
}
