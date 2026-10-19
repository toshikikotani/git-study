import { useId } from 'react';

import type { PathDensityBin } from '@/domain/forecast/path-density';
import type { CumulativeDay } from '@/features/category/pace';

type DensityRow = Pick<CumulativeDay, 'date' | 'index' | 'forecastDensity'>;

/** 金額1円あたりの確率。濃さは同じ日の中だけで比較する。 */
function strengths(bins: readonly PathDensityBin[]): number[] {
  const densities = bins.map((bin) =>
    bin.highYen > bin.lowYen ? bin.probability / (bin.highYen - bin.lowYen) : bin.probability,
  );
  const peak = Math.max(0, ...densities);
  return densities.map((density) => (peak > 0 ? density / peak : 0));
}

/**
 * 日ごとの等しい金額幅に入る確率を濃淡にする。隣り合う日の間だけ色を補間する。
 * 中央値を濃い場所とは仮定せず、確率0の帯は透明、全試行が同額なら線で示す。
 */
export function ForecastDensity({
  rows,
  x,
  y,
  origin,
}: {
  rows: readonly DensityRow[];
  x: (index: number) => number;
  y: (yen: number) => number;
  origin: { x: number; yen: number };
}) {
  const id = useId();
  const opacity = (strength: number) => 0.7 * strength;
  const segments = rows.flatMap((row, rowIndex) => {
    const bins = row.forecastDensity;
    if (!bins?.length) return [];
    const previous = rows[rowIndex - 1];
    const previousBins = previous?.forecastDensity;
    const currentStrengths = strengths(bins);
    const previousStrengths = previousBins?.length ? strengths(previousBins) : null;
    const fractions = [bins, ...(previousBins?.length ? [previousBins] : [])]
      .flatMap((source) => Array.from({ length: source.length + 1 }, (_, i) => i / source.length))
      .filter((fraction, i, all) => all.indexOf(fraction) === i)
      .sort((a, b) => a - b);
    const x0 = previous ? x(previous.index) : origin.x;
    const x1 = x(row.index);
    const slice = (source: readonly PathDensityBin[], from: number, to: number) => {
      const low = source[0]!.lowYen;
      const span = source.at(-1)!.highYen - low;
      return { low: low + span * from, high: low + span * to };
    };

    return fractions.slice(1).map((to, i) => {
      const from = fractions[i]!;
      const middle = (from + to) / 2;
      const current = slice(bins, from, to);
      const before = previousBins?.length ? slice(previousBins, from, to) : null;
      const currentIndex = Math.min(bins.length - 1, Math.floor(middle * bins.length));
      const previousIndex = previousBins?.length
        ? Math.min(previousBins.length - 1, Math.floor(middle * previousBins.length))
        : 0;
      const currentStrength = currentStrengths[currentIndex]!;
      const previousStrength = previousStrengths?.[previousIndex] ?? currentStrength;
      const low0 = before?.low ?? origin.yen;
      const high0 = before?.high ?? origin.yen;
      const low1 = current.low;
      const high1 = current.high;
      const gradientId = `${id}-${rowIndex}-${i}`;
      const collapsed = low0 === high0 && low1 === high1;
      return {
        key: gradientId,
        date: row.date,
        low: low1,
        high: high1,
        strength: currentStrength,
        gradientId,
        x0,
        x1,
        opacity0: opacity(previousStrength),
        opacity1: opacity(currentStrength),
        collapsed,
        path: collapsed
          ? `M${x0},${y(low0)} L${x1},${y(low1)}`
          : `M${x0},${y(low0)} L${x1},${y(low1)} L${x1},${y(high1)} L${x0},${y(high0)} Z`,
      };
    });
  });

  return (
    <g data-forecast-density="true" aria-hidden="true">
      <defs>
        {segments.map((segment) => (
          <linearGradient
            key={segment.key}
            id={segment.gradientId}
            gradientUnits="userSpaceOnUse"
            x1={segment.x0}
            x2={segment.x1}
            y1="0"
            y2="0"
          >
            <stop offset="0" stopColor="var(--caution-mark)" stopOpacity={segment.opacity0} />
            <stop offset="1" stopColor="var(--caution-mark)" stopOpacity={segment.opacity1} />
          </linearGradient>
        ))}
      </defs>
      {segments.map((segment) => (
        <path
          key={segment.key}
          data-density-date={segment.date}
          data-density-low={segment.low}
          data-density-high={segment.high}
          data-density-strength={segment.strength}
          d={segment.path}
          fill={segment.collapsed ? 'none' : `url(#${segment.gradientId})`}
          stroke={segment.collapsed ? `url(#${segment.gradientId})` : 'none'}
          strokeWidth={segment.collapsed ? 3 : undefined}
        />
      ))}
    </g>
  );
}
