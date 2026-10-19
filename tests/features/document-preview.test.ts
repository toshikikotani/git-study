import { describe, expect, it } from 'vitest';

import { projectDocumentBox } from '@/features/import/document-preview';

const square = { width: 200, height: 200 };
const box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };

describe('projectDocumentBox', () => {
  it('同じ縦横比なら検出した位置をそのまま割合に変換する', () => {
    expect(projectDocumentBox(box, { width: 1080, height: 1080 }, square)).toEqual({
      left: 25,
      top: 25,
      width: 50,
      height: 50,
    });
  });

  it('横長の映像を縦長に表示するとき、左右の切り取りを位置に反映する', () => {
    const result = projectDocumentBox(
      { x0: 0.4, y0: 0.25, x1: 0.6, y1: 0.75 },
      { width: 400, height: 200 },
      { width: 200, height: 400 },
    );
    expect(result).toEqual({ left: 10, top: 25, width: 80, height: 50 });
  });

  it('縦長の映像を横長に表示するとき、上下の切り取りを位置に反映する', () => {
    const result = projectDocumentBox(
      { x0: 0.25, y0: 0.4, x1: 0.75, y1: 0.6 },
      { width: 200, height: 400 },
      { width: 400, height: 200 },
    );
    expect(result).toEqual({ left: 25, top: 10, width: 50, height: 80 });
  });

  it('枠が表示範囲を超える場合、表示できる部分だけを返す', () => {
    expect(
      projectDocumentBox(
        { x0: 0, y0: -0.25, x1: 0.75, y1: 0.5 },
        { width: 400, height: 200 },
        square,
      ),
    ).toEqual({ left: 0, top: 0, width: 100, height: 50 });
    expect(projectDocumentBox({ x0: 0.5, y0: 0.5, x1: 2, y1: 2 }, square, square)).toEqual({
      left: 50,
      top: 50,
      width: 50,
      height: 50,
    });
  });

  it('完全に切り取られた枠や表示範囲の端に接するだけの枠は表示しない', () => {
    const landscape = { width: 400, height: 200 };
    expect(projectDocumentBox({ x0: 0, y0: 0.1, x1: 0.2, y1: 0.9 }, landscape, square)).toBeNull();
    expect(projectDocumentBox({ x0: 0, y0: 0.1, x1: 0.25, y1: 0.9 }, landscape, square)).toBeNull();
    expect(projectDocumentBox({ x0: 0.8, y0: 0.1, x1: 1, y1: 0.9 }, landscape, square)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'カメラ準備前や不正な寸法 %s では枠を表示しない',
    (value) => {
      expect(projectDocumentBox(box, { ...square, width: value }, square)).toBeNull();
      expect(projectDocumentBox(box, { ...square, height: value }, square)).toBeNull();
      expect(projectDocumentBox(box, square, { ...square, width: value })).toBeNull();
      expect(projectDocumentBox(box, square, { ...square, height: value })).toBeNull();
    },
  );

  it('空の枠、逆転した枠、有限でない座標は表示しない', () => {
    expect(projectDocumentBox({ ...box, x1: box.x0 }, square, square)).toBeNull();
    expect(projectDocumentBox({ ...box, y1: box.y0 }, square, square)).toBeNull();
    expect(projectDocumentBox({ ...box, x1: 0 }, square, square)).toBeNull();
    expect(projectDocumentBox({ ...box, y1: 0 }, square, square)).toBeNull();
    expect(projectDocumentBox({ ...box, x0: Number.NaN }, square, square)).toBeNull();
    expect(projectDocumentBox({ ...box, y1: Number.POSITIVE_INFINITY }, square, square)).toBeNull();
  });
});
