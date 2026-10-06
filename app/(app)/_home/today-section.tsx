import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { todayAllowance } from '@/domain/forecast/today';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { listGenres } from '@/features/genre/store';
import { getCurrentPlan } from '@/features/spending-plan/store';
import {
  addDays,
  addMonths,
  daysBetween,
  monthStartJst,
  splitDateOnly,
  todayJst,
  weekdayOf,
} from '@/lib/date';
import { LandingRangesCard } from '../reports/landing-ranges-card';
import { TodayCard } from './today-card';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * ホームの「今日あと使える額」とその下のカード(デザインのホーム)を読み込む(重い予測なので、
 * ホームの他の部分を待たせないように Suspense の中で読む)。今日あと使える額・収まる確率・
 * ジャンル別は目標の範囲、月末の収支は今月のすべての支出で出す(レポートと同じ範囲・同じ数字)。
 */
export async function TodaySection() {
  const today = todayJst();
  const monthFrom = monthStartJst();
  const monthPeriod = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const [plan, genres] = await Promise.all([
    getCurrentPlan(today).catch(() => null),
    listGenres().catch(() => []),
  ]);
  const goal = goalForecastArgs(plan);
  const [goalView, monthView] = await Promise.all([
    goal ? loadForecast(goal).catch(() => null) : Promise.resolve(null),
    loadForecast({ period: monthPeriod }).catch(() => null),
  ]);
  const forecast = goalView?.forecast ?? null;
  const [, month, day] = splitDateOnly(today);
  const left = daysBetween(today, monthPeriod.to) + 1;
  const dateLine = `${month}月${day}日(${WEEKDAYS[weekdayOf(today)]}) · ${month}月は残り${left}日`;
  const balance = monthView?.forecast.balance ?? null;
  const rows =
    forecast && goalView
      ? landingRowsFrom({
          forecast,
          excludedByCategory: goalView.excludedByCategory,
          closedGenreIds: new Set(genres.filter((g) => g.forecastClosed).map((g) => g.id)),
          cautionPrecision: goalView.cautionPrecision,
        })
      : [];
  return (
    <div className="space-y-3">
      <TodayCard
        dateLine={dateLine}
        today={
          forecast
            ? todayAllowance({
                capYen: forecast.safeDailyAllowance,
                spentTodayYen: goalView?.todaySpentYen ?? 0,
              })
            : null
        }
        balance={balance ? { ...balance, incomeYen: balance.incomeYen } : null}
        suggestion={forecast?.suggestion ?? null}
        probWithinBudget={forecast?.probWithinBudget ?? null}
        provisional={forecast?.provisional ?? false}
        budget={
          goal && forecast
            ? {
                yen: goal.budgetYen,
                landingP50: forecast.total.p50,
                expectedOvershoot: forecast.expectedOvershoot,
              }
            : null
        }
        monthKey={monthFrom.slice(0, 7)}
      />
      <LandingRangesCard rows={rows} periodLabel="目標の期間" />
    </div>
  );
}
