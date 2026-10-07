import { describe, expect, it } from 'vitest';

import {
  assessReceipt,
  createStabilityTracker,
  cropRect,
  detectDocument,
  otsuThreshold,
  stitchLayout,
  type GrayImage,
} from '@/features/import/document-detect';

/** 暗い背景(40)の中に、明るい紙(220)の矩形を置いた合成画像。 */
function synthetic(
  w: number,
  h: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): GrayImage {
  const data = new Uint8ClampedArray(w * h).fill(40);
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) data[y * w + x] = 220;
  }
  return { width: w, height: h, data };
}

describe('detectDocument', () => {
  it('暗い背景の上の明るい紙の外接矩形を見つける', () => {
    const d = detectDocument(synthetic(100, 100, { x0: 30, y0: 10, x1: 70, y1: 90 }))!;
    expect(d.box.x0).toBeCloseTo(0.3, 1);
    expect(d.box.x1).toBeCloseTo(0.7, 1);
    expect(d.box.y0).toBeCloseTo(0.1, 1);
    expect(d.box.y1).toBeCloseTo(0.9, 1);
    expect(d.coverage).toBeGreaterThan(0.3);
    expect(d.confidence).toBeGreaterThan(0.5);
  });

  it('一様な画面や、紙が小さすぎる画面は検出しない', () => {
    expect(
      detectDocument({ width: 50, height: 50, data: new Uint8ClampedArray(2500).fill(128) }),
    ).toBeNull();
    expect(detectDocument(synthetic(100, 100, { x0: 45, y0: 45, x1: 52, y1: 52 }))).toBeNull();
  });

  it('大津のしきい値は、2つの輝度の間に来る', () => {
    const t = otsuThreshold(synthetic(100, 100, { x0: 30, y0: 10, x1: 70, y1: 90 }));
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(220);
  });
});

describe('createStabilityTracker(自動撮影の判定)', () => {
  const box = { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9 };

  it('同じ位置で連続して検出されたら stable になる', () => {
    const t = createStabilityTracker({ frames: 3 });
    expect(t.push(box).stable).toBe(false);
    expect(t.push(box).stable).toBe(false);
    expect(t.push({ ...box, x0: 0.205 }).stable).toBe(true);
  });

  it('動いたり途切れたりしたら数え直す', () => {
    const t = createStabilityTracker({ frames: 3 });
    t.push(box);
    t.push(box);
    expect(t.push({ ...box, x0: 0.4 }).stable).toBe(false);
    t.push(box);
    t.push(null);
    expect(t.push(box).progress).toBeCloseTo(1 / 3);
  });
});

describe('cropRect / stitchLayout', () => {
  it('余白つきで画素矩形にする(画像の外にはみ出さない)', () => {
    expect(cropRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1000, 2000)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 2000,
    });
  });

  it('長いレシートの分割撮影を、幅をそろえて縦に並べる', () => {
    const layout = stitchLayout([
      { width: 800, height: 1200 },
      { width: 400, height: 600 },
    ]);
    expect(layout.width).toBe(800);
    expect(layout.placements).toEqual([
      { x: 0, y: 0, width: 800, height: 1200 },
      { x: 0, y: 1200, width: 800, height: 1200 },
    ]);
    expect(layout.height).toBe(2400);
  });

  it('高さの上限を超えるなら全体を縮める', () => {
    const layout = stitchLayout(
      [
        { width: 1000, height: 5000 },
        { width: 1000, height: 5000 },
      ],
      6000,
    );
    expect(layout.height).toBeLessThanOrEqual(6000);
    expect(layout.width).toBe(600);
  });
});

/** 紙の中に、印字の行(濃い横線)を等間隔に入れる。 */
function withText(
  img: GrayImage,
  rect: { x0: number; y0: number; x1: number; y1: number },
  every = 6,
): GrayImage {
  const data = Uint8ClampedArray.from(img.data as ArrayLike<number>);
  for (let y = rect.y0 + 4; y < rect.y1 - 4; y += every) {
    for (let x = rect.x0 + 4; x < rect.x0 + Math.floor((rect.x1 - rect.x0) * 0.7); x += 1) {
      data[y * img.width + x] = 50;
    }
  }
  return { ...img, data };
}

describe('assessReceipt(自動シャッターは、レシートと言えるときだけ)', () => {
  const tall = { x0: 50, y0: 20, x1: 110, y1: 200 };

  it('枠の中に縦長の紙があり、印字の行がいくつもあればレシート', () => {
    const img = withText(synthetic(160, 220, tall), tall);
    const d = detectDocument(img)!;
    const a = assessReceipt(img, d);
    expect(a.receipt).toBe(true);
    expect(a.textBands).toBeGreaterThanOrEqual(3);
  });

  it('白紙・光の反射(印字が無い)はレシートとしない', () => {
    const img = synthetic(160, 220, tall);
    const a = assessReceipt(img, detectDocument(img)!);
    expect(a).toMatchObject({ receipt: false, reason: 'no-text' });
  });

  it('画面の端に触れている明るい面(壁・机・画面)はレシートとしない', () => {
    const edge = { x0: 0, y0: 20, x1: 110, y1: 200 };
    const img = withText(synthetic(160, 220, edge), edge);
    const d = detectDocument(img);
    expect(d).not.toBeNull();
    expect(assessReceipt(img, d!)).toMatchObject({ receipt: false, reason: 'edge' });
  });

  it('横長の紙(本・箱・画面など)はレシートとしない', () => {
    const wide = { x0: 20, y0: 70, x1: 140, y1: 140 };
    const img = withText(synthetic(160, 220, wide), wide);
    const d = detectDocument(img)!;
    expect(assessReceipt(img, d)).toMatchObject({ receipt: false, reason: 'shape' });
  });

  it('2秒(8回)ほとんど動かないときだけ、撮ってよいと返す', () => {
    const t = createStabilityTracker();
    const box = { x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9 };
    for (let i = 0; i < 7; i += 1) expect(t.push(box).stable).toBe(false);
    expect(t.push(box).stable).toBe(true);
    // 少し動いたら数え直す
    expect(t.push({ ...box, x0: 0.33 }).stable).toBe(false);
  });
});
