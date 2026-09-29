import { describe, expect, it } from 'vitest';

import {
  NO_CROP,
  clampBrightness,
  clampInsets,
  cropRect,
  isUnadjusted,
  rotateBy,
  rotatedSize,
} from '../../src/domain/image-adjust';

describe('画像の補正(回転・切り抜き・明るさ、受け入れ基準16)', () => {
  it('回転は 90° ずつ、360° で戻る', () => {
    expect(rotateBy(0, 90)).toBe(90);
    expect(rotateBy(0, -90)).toBe(270);
    expect(rotateBy(270, 90)).toBe(0);
  });

  it('90°/270° 回転で幅と高さが入れ替わる', () => {
    expect(rotatedSize(400, 800, 90)).toEqual({ width: 800, height: 400 });
    expect(rotatedSize(400, 800, 180)).toEqual({ width: 400, height: 800 });
  });

  it('切り抜きの範囲は回転後の大きさから計算される', () => {
    expect(cropRect(400, 800, 0, { top: 0.1, right: 0, bottom: 0.1, left: 0.25 })).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 640,
    });
    expect(cropRect(400, 800, 90, NO_CROP)).toEqual({ x: 0, y: 0, width: 800, height: 400 });
  });

  it('余白は 0〜0.4 に丸められ、画像が消えない', () => {
    expect(clampInsets({ top: 0.9, right: -1, bottom: NaN, left: 0.2 })).toEqual({
      top: 0.4,
      right: 0,
      bottom: 0,
      left: 0.2,
    });
    const r = cropRect(100, 100, 0, { top: 0.9, bottom: 0.9, left: 0.9, right: 0.9 });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('明るさは 0.6〜1.6。何も変えていなければ保存しない', () => {
    expect(clampBrightness(3)).toBe(1.6);
    expect(clampBrightness(0)).toBe(0.6);
    expect(isUnadjusted(0, NO_CROP, 1)).toBe(true);
    expect(isUnadjusted(90, NO_CROP, 1)).toBe(false);
    expect(isUnadjusted(0, NO_CROP, 1.2)).toBe(false);
  });
});
