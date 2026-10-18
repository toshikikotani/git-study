import { probabilityAt, trialProbability, type ForecastDistribution } from './distribution';

export type DistributionRange = {
  min: number;
  max: number;
  leftProbability: number;
  rightProbability: number;
  singleAmount: number | null;
  canFocus: boolean;
};

/** 補正後のCDFがlevel以上になる最小の試行額。同額の試行は分割しない。 */
function quantile(distribution: ForecastDistribution, level: number): number {
  const amounts = distribution.amounts;
  let lo = 0;
  let hi = amounts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (probabilityAt(distribution, amounts[mid]!) >= level) hi = mid;
    else lo = mid + 1;
  }
  return amounts[lo]!;
}

/**
 * 中心表示は補正後の5〜95%点と少量の余白。予測の幅や確率は変更しない。
 * 目標を範囲に含めて中心を再び潰さないよう、目標額には依存させない。
 */
export function presentationRange(
  distribution: ForecastDistribution,
  mode: 'focus' | 'full',
): DistributionRange {
  const first = distribution.amounts[0];
  const last = distribution.amounts.at(-1);
  if (first === undefined || last === undefined) {
    return {
      min: 0,
      max: 1,
      leftProbability: 0,
      rightProbability: 0,
      singleAmount: null,
      canFocus: false,
    };
  }
  // 整数円に丸めた最小/最大試行も含める。全試行同額の表示は別の縦線にする。
  const fullMin = first - 1;
  const fullMax = last + 1;
  const lower = quantile(distribution, 0.05);
  const upper = quantile(distribution, 0.95);
  const padding = Math.max(1, Math.ceil((upper - lower) * 0.05));
  const focusMin = Math.max(fullMin, Math.floor(lower - 1 - padding));
  const focusMax = Math.min(fullMax, Math.ceil(upper + padding));
  const min = mode === 'focus' ? focusMin : fullMin;
  const max = mode === 'focus' ? focusMax : fullMax;
  return {
    min,
    max,
    leftProbability: probabilityAt(distribution, min),
    rightProbability: 1 - probabilityAt(distribution, max),
    singleAmount: first === last ? first : null,
    canFocus: focusMin > fullMin || focusMax < fullMax,
  };
}

/** xはfrom, (from+to)/2, to。SVGのQで描く密度の二次Bézier。 */
export type DensitySegment = {
  from: number;
  to: number;
  probability: number;
  startDensity: number;
  controlDensity: number;
  endDensity: number;
};

export type SmoothDistribution = {
  segments: DensitySegment[];
  atoms: { yen: number; probability: number }[];
  peakDensity: number;
  leftProbability: number;
  rightProbability: number;
};

/**
 * 表示用のCDFを単調な三次曲線で補間し、その導関数を密度として描く。
 * 端の同額試行と2%以上の点質量は別の縦線で描く。残りのCDFを補間するため、
 * 目標が最小試行の1円後でも、大きな点質量を1円幅の山へ押し込まない。
 * 各境界までの曲線の面積と点質量の和が、元の probabilityAt と一致する。
 * 正規分布への置き換えはしない。
 *
 * 離散的な試行は境界間でならす表示なので、任意の金額の確率はこの曲線を
 * 積分せず、必ず元の probabilityAt から取得する。
 */
export function smoothDistribution(
  distribution: ForecastDistribution,
  options: { min: number; max: number; anchors?: readonly number[]; bins?: number },
): SmoothDistribution {
  const { min, max } = options;
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min ||
    !distribution.amounts.length
  ) {
    return { segments: [], atoms: [], peakDensity: 0, leftProbability: 0, rightProbability: 0 };
  }
  const count = Math.max(1, Math.min(100, Math.floor(options.bins ?? 24) || 1));
  const anchors = (options.anchors ?? []).filter(
    (anchor) => Number.isFinite(anchor) && anchor > min && anchor < max,
  );
  const binWidth = (max - min) / count;
  const boundaryMargin = binWidth * 0.35;
  const leftForcedTo = Math.max(min, ...anchors.filter((anchor) => anchor - min < boundaryMargin));
  const rightForcedFrom = Math.min(
    max,
    ...anchors.filter((anchor) => max - anchor < boundaryMargin),
  );
  const allAtoms: SmoothDistribution['atoms'] = [];
  const { amounts, calibration } = distribution;
  let before = 0;
  let previousProbability = 0;
  while (before < amounts.length) {
    let after = before + 1;
    while (after < amounts.length && amounts[after] === amounts[before]) after += 1;
    const cumulative = trialProbability(calibration, after, amounts.length);
    const probability = Math.max(0, cumulative - previousProbability);
    const yen = amounts[before]!;
    // 描画端と必須の境界の間は間引けない。狭い端の区間の質量は、
    // 2%未満でも山へ押し込まず、その金額の点として保つ。
    const forcedAtBoundary =
      (yen > min && yen <= leftForcedTo) || (yen > rightForcedFrom && yen <= max);
    if (
      before === 0 ||
      after === amounts.length ||
      probability >= 0.02 - Number.EPSILON * 4 ||
      forcedAtBoundary
    ) {
      allAtoms.push({ yen, probability });
    }
    previousProbability = cumulative;
    before = after;
  }
  const remainingProbability = Math.max(
    0,
    1 - allAtoms.reduce((sum, atom) => sum + atom.probability, 0),
  );
  // 点質量だけで全体を占める場合、丸め誤差を全高の偽の山として拡大しない。
  const continuousProbability =
    remainingProbability <= Number.EPSILON * 8 ? 0 : remainingProbability;
  // 目標が等間隔の境界のすぐ横に来ても、1円幅などの不要な高ピークを作らない。
  // 必須の境界同士と描画の両端は保持し、その近くの通常の境界だけを間引く。
  const edges = Array.from({ length: count + 1 }, (_, i) =>
    i === count ? max : min + binWidth * i,
  ).filter(
    (edge, i) =>
      i === 0 ||
      i === count ||
      anchors.every((anchor) => Math.abs(anchor - edge) >= binWidth * 0.35),
  );
  edges.push(...anchors);
  edges.sort((a, b) => a - b);
  const x = edges.filter((edge, i) => i === 0 || edge !== edges[i - 1]);
  const originalCdf = x.map((edge) => probabilityAt(distribution, edge));
  const cdf = x.map((edge, i) =>
    Math.max(
      0,
      Math.min(
        continuousProbability,
        originalCdf[i]! -
          allAtoms.reduce((sum, atom) => sum + (atom.yen <= edge ? atom.probability : 0), 0),
      ),
    ),
  );
  const widths = x.slice(1).map((edge, i) => edge - x[i]!);
  const secants = widths.map((width, i) => Math.max(0, (cdf[i + 1]! - cdf[i]!) / width));
  const slopes = x.map((_, i) => {
    if (i === 0) return originalCdf[0] === 0 ? 0 : secants[0]!;
    if (i === x.length - 1) return originalCdf[i] === 1 ? 0 : secants.at(-1)!;
    const before = secants[i - 1]!;
    const after = secants[i]!;
    if (before === 0 || after === 0) return 0;
    // 幅の違う区間でも安定するPCHIPの重み付き調和平均。
    const w1 = 2 * widths[i]! + widths[i - 1]!;
    const w2 = widths[i]! + 2 * widths[i - 1]!;
    return (w1 + w2) / (w1 / before + w2 / after);
  });
  // 各Bézierの制御点も非負に保つ。共有する傾きは減らすだけなので、
  // 左からの1巡で前の区間の制約を壊さず、境界の密度も連続する。
  for (let i = 0; i < secants.length; i += 1) {
    const sum = slopes[i]! + slopes[i + 1]!;
    const limit = 3 * secants[i]!;
    if (sum > limit) {
      const factor = limit / sum;
      slopes[i] = slopes[i]! * factor;
      slopes[i + 1] = slopes[i + 1]! * factor;
    }
  }
  const segments = widths.map((_, i): DensitySegment => {
    const startDensity = slopes[i]!;
    const endDensity = slopes[i + 1]!;
    return {
      from: x[i]!,
      to: x[i + 1]!,
      probability: Math.max(0, cdf[i + 1]! - cdf[i]!),
      startDensity,
      controlDensity: Math.max(0, 3 * secants[i]! - startDensity - endDensity),
      endDensity,
    };
  });
  let peakDensity = 0;
  for (const segment of segments) {
    const { startDensity: a, controlDensity: b, endDensity: c } = segment;
    peakDensity = Math.max(peakDensity, a, c);
    const denominator = a - 2 * b + c;
    const t = denominator === 0 ? -1 : (a - b) / denominator;
    if (t > 0 && t < 1) {
      peakDensity = Math.max(peakDensity, (1 - t) ** 2 * a + 2 * t * (1 - t) * b + t ** 2 * c);
    }
  }
  return {
    segments,
    atoms: allAtoms.filter((atom) => atom.yen > min && atom.yen <= max),
    peakDensity,
    leftProbability: originalCdf[0]!,
    rightProbability: 1 - originalCdf.at(-1)!,
  };
}
