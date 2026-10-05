/**
 * 確率予測の結果から、グラフに描く「残りの期間の支出」(予定を除く)を取り出す。
 * グラフの予測の線は、今日の実績にこの額を日数に比例して足し、予定の支出は日付の段差で足す。
 * 着地(実績 + 予定 + 固定費 + 残り)と同じ予測から描くので、画面ごとに数字が食い違わない。
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
  };
}

/** 1つのカテゴリ。予測にそのカテゴリが無ければ null。 */
export function remainingOfCategory(
  forecast: Forecast,
  categoryId: string,
): RemainingForecast | null {
  const cat = forecast.byCategory.find((c) => c.categoryId === categoryId);
  if (cat === undefined) return null;
  const known = cat.actualYen + cat.scheduledYen;
  return {
    lowYen: Math.max(0, cat.landing.p10 - known),
    medianYen: Math.max(0, cat.landing.p50 - known),
    highYen: Math.max(0, cat.landing.p90 - known),
  };
}
