/**
 * もし今日これだけ使ったら(デザイン v3-2、ADR-108)。ホームと同じ予測(今期の目標・今月)を、
 * 「いつも通り」と「今日これだけ使ったら」で出し比べる。着地見込み・目標内の確率・明日からの目安・
 * 月末の貯金の前 → 後を返す。読み込みは期間ごとに1回(prepareForecast)。
 * AIの窓口も同じものを使う(「やばい？」に数字で答える、ADR-108)。
 */

import { goalForecastArgs } from '@/features/forecast/goal';
import { prepareForecast, type ExtraSpend, type ForecastView } from '@/features/forecast/load';
import { getAppSettings } from '@/features/settings/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { jstClock, type SpendOutcome, type WhatIfSpend } from '@/domain/forecast/what-if-spend';
import { addDays, addMonths, monthStartJst, todayJst } from '@/lib/date';

export type { SpendOutcome, WhatIfSpend };

/** 1回に試せる額の数と、1つの額の上限。 */
export const MAX_WHAT_IF_AMOUNTS = 6;
export const MAX_WHAT_IF_YEN = 1_000_000;

function outcomeOf(
  amountYen: number,
  goal: ForecastView | null,
  month: ForecastView | null,
): SpendOutcome {
  return {
    amountYen,
    landingYen: goal?.forecast.total.p50 ?? null,
    probWithinBudget: goal?.forecast.probWithinBudget ?? null,
    tomorrowYen: goal?.tomorrowLimit?.todayLimitYen ?? null,
    monthEndYen: month?.forecast.balance?.p50 ?? null,
  };
}

export async function simulateTodaySpends(
  amounts: readonly number[],
  genre: { id: string; name: string } | null,
  now: Date = new Date(),
): Promise<WhatIfSpend> {
  const today = todayJst(now);
  const monthFrom = monthStartJst(0, now);
  const monthPeriod = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const [plan, settings] = await Promise.all([
    getCurrentPlan(today).catch(() => null),
    getAppSettings().catch(() => null),
  ]);
  const goal = goalForecastArgs(plan);
  const [goalRun, monthRun] = await Promise.all([
    goal ? prepareForecast({ ...goal, now }).catch(() => null) : Promise.resolve(null),
    prepareForecast({ period: monthPeriod, now }).catch(() => null),
  ]);
  const run = (extra?: ExtraSpend) =>
    outcomeOf(extra?.amountYen ?? 0, goalRun?.(extra) ?? null, monthRun?.(extra) ?? null);
  return {
    budgetYen: goal?.budgetYen ?? null,
    monthlySavingsTargetYen: settings?.monthlySavingsTargetYen ?? 0,
    base: run(),
    options: amounts.map((amountYen) =>
      run({ amountYen, genreId: genre?.id ?? null, genreName: genre?.name ?? null }),
    ),
    computedAt: jstClock(now),
  };
}
