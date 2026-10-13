/**
 * 支出トレンド判定（提案A: 短期移動平均 vs 長期移動平均）
 *
 * - 短期: 7日移動平均
 * - 長期: 21日移動平均
 * - 短期 > 長期 → 増加傾向
 * - 短期 < 長期 → 減少傾向
 * - 差が小さい場合は安定
 */

import type { DateOnly } from '@/lib/date';
import { addDays } from '@/lib/date';

export const SHORT_WINDOW = 7;
export const LONG_WINDOW = 21;

/** 短期MAと長期MAの差がこれ以下なら「安定」と判定する（円） */
const STABLE_THRESHOLD_YEN = 500;

export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

export type TrendPoint = {
  date: DateOnly;
  /** その日の実績支出（正の数） */
  spentYen: number;
  shortMa: number | null;
  longMa: number | null;
};

export type TrendResult = {
  points: TrendPoint[];
  direction: TrendDirection;
  /** 最新の短期MA */
  latestShortMa: number | null;
  /** 最新の長期MA */
  latestLongMa: number | null;
  /** 判定に使用した最新日 */
  asOf: DateOnly | null;
};

/** 日次支出マップから、指定期間の時系列（穴埋め）を作る */
export function buildDailySeries(
  daySpend: Readonly<Record<string, number>>,
  from: DateOnly,
  to: DateOnly,
): { date: DateOnly; spentYen: number }[] {
  const series: { date: DateOnly; spentYen: number }[] = [];
  let current = from;
  while (current <= to) {
    series.push({
      date: current,
      spentYen: daySpend[current] ?? 0,
    });
    current = addDays(current, 1);
  }
  return series;
}

function sma(values: number[], window: number, index: number): number | null {
  if (index < window - 1) return null;
  let sum = 0;
  for (let i = index - window + 1; i <= index; i++) {
    sum += values[i]!;
  }
  return sum / window;
}

/** トレンドを計算する */
export function computeTrend(
  daily: readonly { date: DateOnly; spentYen: number }[],
): TrendResult {
  if (daily.length === 0) {
    return {
      points: [],
      direction: 'stable',
      latestShortMa: null,
      latestLongMa: null,
      asOf: null,
    };
  }

  const spent = daily.map((d) => d.spentYen);
  const points: TrendPoint[] = daily.map((d, i) => ({
    date: d.date,
    spentYen: d.spentYen,
    shortMa: sma(spent, SHORT_WINDOW, i),
    longMa: sma(spent, LONG_WINDOW, i),
  }));

  // 最新の判定可能な点（長期MAが存在する最新日）
  const latest = [...points].reverse().find((p) => p.longMa !== null);
  if (!latest || latest.shortMa === null || latest.longMa === null) {
    return {
      points,
      direction: 'stable',
      latestShortMa: latest?.shortMa ?? null,
      latestLongMa: latest?.longMa ?? null,
      asOf: latest?.date ?? null,
    };
  }

  const diff = latest.shortMa - latest.longMa;
  let direction: TrendDirection = 'stable';
  if (diff > STABLE_THRESHOLD_YEN) direction = 'increasing';
  else if (diff < -STABLE_THRESHOLD_YEN) direction = 'decreasing';

  return {
    points,
    direction,
    latestShortMa: latest.shortMa,
    latestLongMa: latest.longMa,
    asOf: latest.date,
  };
}

export function directionLabel(direction: TrendDirection): string {
  switch (direction) {
    case 'increasing':
      return '増加傾向';
    case 'decreasing':
      return '減少傾向';
    case 'stable':
      return '安定';
  }
}
