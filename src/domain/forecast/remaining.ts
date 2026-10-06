/**
 * 確率予測の結果から、グラフに描く「今日より先に足される額」を取り出す。
 * グラフの線と帯は、着地と同じ試行の日ごとの分位(forecast.path)をそのまま使うので、
 * 見出しの着地とグラフの右端が食い違わない。カテゴリごとの日ごとの分位は持たないので、
 * カテゴリは「残りの額を日数に比例して足す」近似にする(カテゴリ画面は、そのジャンルだけの
 * 予測を作るので、全体の path がそのカテゴリの path になる)。
 */

import type { RemainingForecast } from '@/features/category/pace';
import type { Forecast } from './types';

/** 全体(forecast の範囲すべて)。 */
export function remainingOfTotal(forecast: Forecast): RemainingForecast {
  const known = forecast.actualYen + forecast.committed.scheduledYen;
  return {
    lowYen: Math.max(0, forecast.total.p10 - known),
    medianYen: Math.max(0, forecast.total.p50 - known),
    highYen: Math.max(0, forecast.total.p90 - known),
    path: forecast.path.map((p) => ({
      date: p.date,
      lowYen: p.p10,
      medianYen: p.p50,
      highYen: p.p90,
      innerLowYen: p.p25,
      innerHighYen: p.p75,
    })),
    profile: forecast.typicalProfile,
  };
}

/** 1つのカテゴリ。予測にそのカテゴリが無ければ null。 */
export function remainingOfCategory(
  forecast: Forecast,
  categoryId: string,
): RemainingForecast | null {
  const cat = forecast.byCategory.find((c) => c.categoryId === categoryId);
  if (cat === undefined) return null;
  // そのジャンルだけの予測(カテゴリ画面)なら、全体の日ごとの分位がそのまま使える。
  if (forecast.byCategory.length === 1) return remainingOfTotal(forecast);
  const known = cat.actualYen + cat.scheduledYen;
  return {
    lowYen: Math.max(0, cat.landing.p10 - known),
    medianYen: Math.max(0, cat.landing.p50 - known),
    highYen: Math.max(0, cat.landing.p90 - known),
  };
}
