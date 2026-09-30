import { describe, expect, it } from 'vitest';

import {
  TAG_HEIGHT,
  TICK_HEIGHT,
  gutterIsValid,
  layoutGutter,
  type GutterItem,
} from '../../../src/features/category/chart-layout';

const PLOT = 176;
const tag = (key: string, ratio: number): GutterItem => ({
  key,
  kind: 'tag',
  ratio,
  height: TAG_HEIGHT,
});
const tick = (ratio: number): GutterItem => ({
  key: `tick-${ratio}`,
  kind: 'tick',
  ratio,
  height: TICK_HEIGHT,
});

describe('R3 右の余白のラベルの配置', () => {
  it('離れているラベルは、元の位置のまま', () => {
    const p = layoutGutter([tick(1), tick(0.5), tag('average', 0.2)], PLOT);
    expect(gutterIsValid(p, PLOT)).toBe(true);
    expect(p.find((x) => x.key === 'average')!.centerPx).toBeCloseTo((1 - 0.2) * PLOT, 5);
    expect(p.some((x) => x.shifted && x.kind === 'tag')).toBe(false);
  });

  it('「目安」と「平均」が近すぎるとき、上下にずらして重ねない', () => {
    const p = layoutGutter([tag('allowance', 0.4), tag('average', 0.39)], PLOT);
    expect(gutterIsValid(p, PLOT)).toBe(true);
    const a = p.find((x) => x.key === 'allowance')!;
    const b = p.find((x) => x.key === 'average')!;
    expect(Math.abs(a.centerPx - b.centerPx)).toBeGreaterThanOrEqual(TAG_HEIGHT);
    expect(a.shifted || b.shifted).toBe(true);
  });

  it('上端・下端に近いタグも、描画領域の外へはみ出さない', () => {
    for (const r of [0, 0.01, 0.99, 1]) {
      const p = layoutGutter([tag('allowance', r), tag('average', r)], PLOT);
      expect(gutterIsValid(p, PLOT)).toBe(true);
    }
  });

  it('タグと重なる目盛りは外す(タグを優先)', () => {
    const p = layoutGutter([tick(0.5), tick(1), tag('allowance', 0.5)], PLOT);
    expect(p.some((x) => x.key === 'tick-0.5')).toBe(false);
    expect(p.some((x) => x.key === 'allowance')).toBe(true);
    expect(p.some((x) => x.key === 'tick-1')).toBe(true);
  });

  it('どんな組み合わせでも、すべてが収まり重ならない(全探索)', () => {
    const ratios = [0, 0.03, 0.1, 0.25, 0.4, 0.5, 0.66, 0.9, 1];
    for (const a of ratios) {
      for (const b of ratios) {
        const p = layoutGutter([tick(1), tick(0.5), tag('allowance', a), tag('average', b)], PLOT);
        expect(gutterIsValid(p, PLOT)).toBe(true);
      }
    }
  });
});
