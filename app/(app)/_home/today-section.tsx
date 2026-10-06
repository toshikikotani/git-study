import { todayAllowance } from '@/domain/forecast/today';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { addDays, addMonths, monthStartJst, todayJst } from '@/lib/date';
import { TodayCard } from './today-card';

/**
 * ホームの「今日あと使える額」を読み込む(重い予測なので、ホームの他の部分を待たせない
 * ように Suspense の中で読む)。今日あと使える額と収まる確率は目標の範囲、月末の収支は
 * 今月のすべての支出で出す(レポートと同じ範囲・同じ数字)。
 */
export async function TodaySection() {
  const today = todayJst();
  const monthFrom = monthStartJst();
  const monthPeriod = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const plan = await getCurrentPlan(today).catch(() => null);
  const goal = goalForecastArgs(plan);
  const [goalView, monthView] = await Promise.all([
    goal ? loadForecast(goal).catch(() => null) : Promise.resolve(null),
    loadForecast({ period: monthPeriod }).catch(() => null),
  ]);
  const forecast = goalView?.forecast ?? null;
  return (
    <TodayCard
      today={
        forecast
          ? todayAllowance({
              capYen: forecast.safeDailyAllowance,
              spentTodayYen: goalView?.todaySpentYen ?? 0,
            })
          : null
      }
      balance={monthView?.forecast.balance ?? null}
      suggestion={forecast?.suggestion ?? null}
      probWithinBudget={forecast?.probWithinBudget ?? null}
      provisional={forecast?.provisional ?? false}
    />
  );
}
