import { describe, expect, it } from 'vitest';

import {
  forecastDistribution,
  probabilityAt,
  type ForecastDistribution,
} from '@/domain/forecast/distribution';
import {
  presentationRange,
  smoothDistribution,
  type DensitySegment,
  type SmoothDistribution,
} from '@/domain/forecast/distribution-presentation';

function density(segment: DensitySegment, t: number): number {
  return (
    (1 - t) ** 2 * segment.startDensity +
    2 * t * (1 - t) * segment.controlDensity +
    t ** 2 * segment.endDensity
  );
}

/** Simpson積分は二次曲線の面積を正確に求められる。 */
function area(segment: DensitySegment): number {
  return (
    ((segment.to - segment.from) / 6) *
    (density(segment, 0) + 4 * density(segment, 0.5) + density(segment, 1))
  );
}

function atomMass(curve: SmoothDistribution, through = Infinity): number {
  return curve.atoms.reduce((sum, atom) => sum + (atom.yen <= through ? atom.probability : 0), 0);
}

function totalMass(curve: SmoothDistribution, through = Infinity): number {
  return (
    curve.segments
      .filter((segment) => segment.to <= through)
      .reduce((sum, segment) => sum + area(segment), 0) + atomMass(curve, through)
  );
}

const skewed = forecastDistribution(
  [...Array.from({ length: 998 }, (_, i) => 210000 + i * 100), 800000, 935000],
  null,
);

describe('予測分布の表示範囲', () => {
  it('まれな高額が中心を潰さず、全体表示へ戻すと全試行が入る', () => {
    const focus = presentationRange(skewed, 'focus');
    const full = presentationRange(skewed, 'full');
    expect(focus.canFocus).toBe(true);
    expect(focus.max - focus.min).toBeLessThan((full.max - full.min) / 4);
    expect(focus.leftProbability).toBeLessThanOrEqual(0.05);
    expect(focus.rightProbability).toBeLessThanOrEqual(0.05);
    expect(focus.leftProbability).toBe(probabilityAt(skewed, focus.min));
    expect(focus.rightProbability).toBe(1 - probabilityAt(skewed, focus.max));
    expect(full.min).toBe(209999);
    expect(full.max).toBe(935001);
    expect(full.leftProbability).toBe(0);
    expect(full.rightProbability).toBe(0);
    expect(skewed.amounts.at(-1)).toBe(935000);
  });

  it('補正後の確率で中心を選び、生の試行の5〜95%点に固定しない', () => {
    const amounts = Array.from({ length: 1000 }, (_, i) => i * 1000);
    const raw = forecastDistribution(amounts, null);
    const calibrated = forecastDistribution(amounts, { pit: [0.5], pitWeight: 0.8 });
    const focus = presentationRange(calibrated, 'focus');
    expect(focus.min).toBeGreaterThan(presentationRange(raw, 'focus').min);
    expect(focus.max).toBeLessThan(presentationRange(raw, 'focus').max);
    expect(focus.leftProbability).toBeLessThanOrEqual(0.05);
    expect(focus.rightProbability).toBeLessThanOrEqual(0.05);
  });

  it.each([-1000, 0, 255000])('全試行が%d円なら、見せかけの予測幅を作らず単一額を返す', (yen) => {
    const range = presentationRange(forecastDistribution([yen, yen, yen], null), 'focus');
    expect(range.singleAmount).toBe(yen);
    expect(range.min).toBeLessThan(yen);
    expect(range.max).toBeGreaterThan(yen);
    expect(range.canFocus).toBe(false);
    expect(range.leftProbability + range.rightProbability).toBe(0);
  });

  it('少数の試行・負の着地・空データでも有限の表示幅を返す', () => {
    for (const amounts of [[], [100], [100, 200], [-1000, -500, 0], [-0.5, 0.5]]) {
      for (const mode of ['focus', 'full'] as const) {
        const range = presentationRange(forecastDistribution(amounts, null), mode);
        expect(Number.isFinite(range.min)).toBe(true);
        expect(Number.isFinite(range.max)).toBe(true);
        expect(range.max).toBeGreaterThan(range.min);
      }
    }
  });
});

describe('同じCDFから描く滑らかな密度', () => {
  const calibrated = forecastDistribution(
    [100000, 100000, 110000, 110000, 110000, 120000, 120000, 500000],
    { pit: [0, 0.1, 0.5, 0.8], pitWeight: 0.25, prior: [0, 0.2, 0.8, 1] },
  );

  it.each([skewed, calibrated])(
    '曲線と点質量の和が1で、目標・選択額までの確率が元の確率と一致する',
    (distribution) => {
      const range = presentationRange(distribution, 'full');
      const anchors = [110000, 113879, 189000, 255000, 310000].filter(
        (yen) => yen > range.min && yen < range.max,
      );
      const curve = smoothDistribution(distribution, { ...range, anchors });
      expect(totalMass(curve)).toBeCloseTo(1, 12);
      for (const anchor of anchors) {
        const below = curve.segments.filter((segment) => segment.to <= anchor);
        expect(below.at(-1)!.to).toBe(anchor);
        expect(totalMass(curve, anchor)).toBeCloseTo(probabilityAt(distribution, anchor), 12);
      }
      for (const segment of curve.segments) {
        expect(area(segment)).toBeCloseTo(segment.probability, 12);
      }
    },
  );

  it('中心表示の面積を勝手に100%へ広げず、省略した左右の確率と合わせて1になる', () => {
    const range = presentationRange(skewed, 'focus');
    const anchor = 255000;
    const curve = smoothDistribution(skewed, { ...range, anchors: [anchor] });
    const visible = totalMass(curve);
    expect(curve.leftProbability).toBe(range.leftProbability);
    expect(curve.rightProbability).toBe(range.rightProbability);
    expect(curve.leftProbability + visible + curve.rightProbability).toBeCloseTo(1, 12);
    const under = totalMass(curve, anchor);
    expect(curve.leftProbability + under).toBeCloseTo(probabilityAt(skewed, anchor), 12);
  });

  it('境界の密度が連続し、幅の極端に小さい区間や空の区間でも負にならない', () => {
    const range = presentationRange(skewed, 'full');
    const curve = smoothDistribution(skewed, {
      ...range,
      anchors: [210000, 210000.00001, 211000, 213879, 213879.000001, 934999.99999],
    });
    const samples = curve.segments.flatMap((segment, i) => {
      if (i > 0) expect(segment.startDensity).toBe(curve.segments[i - 1]!.endDensity);
      expect(segment.controlDensity).toBeGreaterThanOrEqual(0);
      return Array.from({ length: 101 }, (_, j) => density(segment, j / 100));
    });
    expect(samples.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(curve.peakDensity).toBeGreaterThan(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(curve.peakDensity * (1 + 1e-12));
  });

  it('分数の境界・重複した境界・範囲外の目標を安全に扱う', () => {
    const distribution = forecastDistribution([-0.1, 0.1, 0.9, 10.1], null);
    const anchors = [-1, 0, 0.5, 1, 1, 1.000001, 11, Infinity, NaN];
    const curve = smoothDistribution(distribution, { min: -0.5, max: 10.5, anchors, bins: 7 });
    for (const anchor of [0, 0.5, 1, 1.000001]) {
      expect(curve.segments.some((segment) => segment.to === anchor)).toBe(true);
    }
    expect(curve.segments.every((segment) => segment.to > segment.from)).toBe(true);
    for (const anchor of [0, 0.5, 1, 1.000001]) {
      const mass = totalMass(curve, anchor);
      expect(mass + curve.leftProbability).toBeCloseTo(probabilityAt(distribution, anchor), 12);
    }
    expect(curve.rightProbability).toBe(0.25);
  });

  it('目標が通常の境界から1円だけ離れていても、表示上の細い高ピークを作らない', () => {
    const distribution = forecastDistribution(
      [...Array.from({ length: 1000 }, (_, i) => i + 1), ...Array<number>(500).fill(101)].sort(
        (a, b) => a - b,
      ),
      null,
    );
    const anchor = 101;
    const curve = smoothDistribution(distribution, {
      min: 0,
      max: 1000,
      bins: 10,
      anchors: [anchor],
    });
    const anchorSegments = curve.segments.filter(
      (segment) => segment.from === anchor || segment.to === anchor,
    );
    expect(anchorSegments).toHaveLength(2);
    expect(anchorSegments.every((segment) => segment.to - segment.from >= 35)).toBe(true);
    expect(curve.segments.some((segment) => segment.from === 100 || segment.to === 100)).toBe(
      false,
    );
    // 101円に集まる質量は残すが、1円幅の密度へ押し込まない。
    expect(curve.peakDensity).toBeLessThan(0.01);
    expect(totalMass(curve)).toBeCloseTo(1, 12);
    expect(totalMass(curve, anchor)).toBeCloseTo(probabilityAt(distribution, anchor), 12);
  });

  it('最小額に50%集中していても、その額の目標が1円幅の偽の山を作らない', () => {
    const distribution = forecastDistribution(
      [
        ...Array<number>(500).fill(100000),
        ...Array.from({ length: 500 }, (_, i) => 200000 + i * 100),
      ],
      null,
    );
    const range = presentationRange(distribution, 'focus');
    const withoutAnchor = smoothDistribution(distribution, range);
    expect(withoutAnchor.atoms.find((atom) => atom.yen === 100000)?.probability).toBe(0.5);
    expect(withoutAnchor.peakDensity).toBeGreaterThan(0);
    for (const anchor of [100000, 100001]) {
      const curve = smoothDistribution(distribution, { ...range, anchors: [anchor] });
      expect(curve.peakDensity).toBeLessThanOrEqual(withoutAnchor.peakDensity * 1.01);
      expect(totalMass(curve, anchor) + curve.leftProbability).toBeCloseTo(
        probabilityAt(distribution, anchor),
        12,
      );
      expect(totalMass(curve) + curve.leftProbability + curve.rightProbability).toBeCloseTo(1, 12);
    }
  });

  it('生の件数比ではなく校正後2%以上の点質量を抽出し、元の分布は変更しない', () => {
    const distribution = forecastDistribution(
      Array.from({ length: 100 }, (_, i) => i),
      { pit: [0.5], pitWeight: 0.8 },
    );
    const before = JSON.stringify(distribution);
    const curve = smoothDistribution(distribution, { min: -1, max: 100, anchors: [49] });
    expect(curve.atoms.map((atom) => atom.yen)).toEqual([0, 49, 99]);
    expect(curve.atoms.find((atom) => atom.yen === 49)?.probability).toBeCloseTo(0.802, 12);
    expect(totalMass(curve)).toBeCloseTo(1, 12);
    expect(totalMass(curve, 49)).toBeCloseTo(probabilityAt(distribution, 49), 12);
    expect(JSON.stringify(distribution)).toBe(before);
    // minと同額の点質量は左の裾へ数え、可視側へ二重計上しない。
    const cropped = smoothDistribution(distribution, { min: 49, max: 99 });
    expect(cropped.atoms.map((atom) => atom.yen)).toEqual([99]);
    expect(cropped.leftProbability).toBe(probabilityAt(distribution, 49));
    expect(totalMass(cropped) + cropped.leftProbability + cropped.rightProbability).toBeCloseTo(
      1,
      12,
    );
  });

  it('ちょうど2%ずつの点質量だけなら、丸め誤差から偽の山を描かない', () => {
    const distribution = forecastDistribution(
      Array.from({ length: 50 }, (_, i) => i * 10),
      null,
    );
    const curve = smoothDistribution(distribution, { min: -1, max: 500 });
    expect(curve.atoms).toHaveLength(50);
    expect(curve.peakDensity).toBe(0);
    expect(curve.segments.every((segment) => area(segment) === 0)).toBe(true);
    expect(atomMass(curve)).toBeCloseTo(1, 12);
  });

  it.each(['left', 'right'] as const)('2%未満の集中も%s端の狭い区間へ押し込まない', (side) => {
    const amounts = [
      100000,
      ...Array<number>(19).fill(100001),
      ...Array.from({ length: 980 }, (_, i) => 200000 + i * 100),
    ];
    const mirrored = side === 'left' ? amounts : amounts.map((yen) => 400000 - yen).reverse();
    const distribution = forecastDistribution(mirrored, null);
    const range = presentationRange(distribution, 'full');
    // 右端では(anchor,max]、左端では(min,anchor]に集中額が入る。
    const anchor = side === 'left' ? 100001 : 299998;
    const withoutAnchor = smoothDistribution(distribution, { ...range, bins: 18 });
    const curve = smoothDistribution(distribution, { ...range, bins: 18, anchors: [anchor] });
    expect(
      curve.atoms.find((atom) => atom.yen === (side === 'left' ? 100001 : 299999))?.probability,
    ).toBeCloseTo(0.019, 12);
    expect(curve.peakDensity).toBeLessThan(withoutAnchor.peakDensity * 1.1);
    expect(totalMass(curve) + curve.leftProbability + curve.rightProbability).toBeCloseTo(1, 12);
    expect(totalMass(curve, anchor) + curve.leftProbability).toBeCloseTo(
      probabilityAt(distribution, anchor),
      12,
    );
  });

  it('返金で負の着地を持つ分布でも、0円までの面積と確率が一致する', () => {
    const distribution = forecastDistribution([-1500, -1000, 500], null);
    const curve = smoothDistribution(distribution, { min: -1501, max: 501, anchors: [0] });
    expect(totalMass(curve, 0)).toBeCloseTo(2 / 3, 12);
  });

  it('空の分布や無効な範囲は空で返し、同額・幅が極小でもNaNを出さない', () => {
    const empty: ForecastDistribution = { amounts: [], calibration: null };
    expect(smoothDistribution(empty, { min: 0, max: 1 }).segments).toEqual([]);
    for (const [min, max] of [
      [0, 0],
      [1, 0],
      [NaN, 1],
      [0, Infinity],
    ]) {
      expect(smoothDistribution(skewed, { min: min!, max: max! }).segments).toEqual([]);
    }
    const distribution = forecastDistribution([0, 0, 0], null);
    for (const [min, max] of [
      [-1, 1],
      [-0.00001, 0.00001],
      [1, 2],
    ]) {
      const curve = smoothDistribution(distribution, { min: min!, max: max!, anchors: [0] });
      expect(JSON.stringify(curve)).not.toMatch(/null/);
      expect(curve.peakDensity).toBeGreaterThanOrEqual(0);
    }
  });
});
