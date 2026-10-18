/**
 * ホームの「今日」(今日使える目安・今期の見通し・月末に残る見込み)の予測を読み込む。
 * ホームの画面と AIの窓口(features/advisor/context.ts)が同じここから受け取り、
 * AIが画面と違う数字で話さないようにする(ADR-106)。呼ぶたびに明細から計算し直す。
 */

import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { watchCategories, type WatchCategory } from '@/domain/forecast/watch-categories';
import { goalForecastArgs, type GoalForecastArgs } from '@/features/forecast/goal';
import { loadForecast, type ForecastView } from '@/features/forecast/load';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { getAppSettings } from '@/features/settings/store';
import { addDays, addMonths, monthStartJst, todayJst, type DateOnly } from '@/lib/date';

export type TodayForecasts = {
  today: DateOnly;
  /** 今月(暦の1か月)。月末に残る見込みの期間。 */
  monthPeriod: { from: DateOnly; to: DateOnly };
  /** 今期の目標(予算が無ければ null)。 */
  goal: GoalForecastArgs | null;
  /** 今期の目標の予測(目標が無い・読めなければ null)。 */
  goalView: ForecastView | null;
  /** 今月の予測(月末に残る見込み)。読めなければ null。 */
  monthView: ForecastView | null;
  payday: number | null;
  /** 毎月の貯金目標(設定。AIの窓口と同じ値、ADR-108)。0 なら決めていない。 */
  monthlySavingsTargetYen: number;
};

export async function loadTodayForecasts(now: Date = new Date()): Promise<TodayForecasts> {
  const today = todayJst(now);
  const monthFrom = monthStartJst(0, now);
  const monthPeriod = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const [plan, settings] = await Promise.all([
    getCurrentPlan(today).catch(() => null),
    getAppSettings().catch(() => null),
  ]);
  const goal = goalForecastArgs(plan);
  const [goalView, monthView] = await Promise.all([
    goal ? loadForecast({ ...goal, now }).catch(() => null) : Promise.resolve(null),
    loadForecast({ period: monthPeriod, now }).catch(() => null),
  ]);
  return {
    today,
    monthPeriod,
    goal,
    goalView,
    monthView,
    payday: settings?.payday ?? null,
    monthlySavingsTargetYen: settings?.monthlySavingsTargetYen ?? 0,
  };
}

/** 今日の1日の上限(休日軸・確率込みの上限、無ければ予測の安全な1日分)。 */
export function todayCapYen(view: ForecastView): number {
  return view.dailyLimit?.todayLimitYen ?? view.forecast.safeDailyAllowance ?? 0;
}

/**
 * ホームに出す「気をつけたいカテゴリ」(目標をこえた・こえそう・8割をこえた、最大3つ、ADR-117)。
 * 今期の目標の予測から選ぶ(読み込みを増やさない)。AIの窓口にも同じものを渡す。
 */
export function watchCategoriesOf(view: ForecastView): WatchCategory[] {
  const rows = landingRowsFrom({
    forecast: view.forecast,
    excludedByCategory: view.excludedByCategory,
    closedGenreIds: view.closedGenreIds,
    cautionPrecision: view.cautionPrecision,
  });
  return watchCategories({
    rows,
    byCategory: view.forecast.byCategory,
    closedGenreIds: view.closedGenreIds,
  });
}
