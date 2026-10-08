import { todayAllowance } from '@/domain/forecast/today';
import { goalForecastArgs } from '@/features/forecast/goal';
import { loadForecast } from '@/features/forecast/load';
import { countPendingReview } from '@/features/home/pending';
import { getCurrentPlan } from '@/features/spending-plan/store';
import { addDays, addMonths, monthStartJst, splitDateOnly, todayJst } from '@/lib/date';
import { HomeList, type HomeListProps } from './home-list';
import { TodayCard } from './today-card';

/** 「10月の見通し」(暦の1か月の目標)/「10月14日までの見通し」(それ以外)。 */
export function outlookLabel(period: { from: string; to: string }): string {
  const [, fm, fd] = splitDateOnly(period.from);
  const [ty, tm, td] = splitDateOnly(period.to);
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (fd === 1 && fm === tm && td === lastDay) return `${tm}月の見通し`;
  return `${tm}月${td}日までの見通し`;
}

/**
 * ホームの「今日使える額」から下(デザインの「今日」、ADR-085)を読み込む(重い予測なので、
 * ホームの他の部分を待たせないように Suspense の中で読む)。今日使える額・見通し・次の一手は
 * 見通しと月末に残る見込みは、同じ範囲(目標があれば目標のジャンル)の同じ数字にする。
 */
export async function TodaySection({ savings }: { savings: HomeListProps['savings'] }) {
  const today = todayJst();
  const monthFrom = monthStartJst();
  const monthPeriod = { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) };
  const [plan, pendingCount] = await Promise.all([
    getCurrentPlan(today).catch(() => null),
    countPendingReview(),
  ]);
  const goal = goalForecastArgs(plan);
  const [goalView, monthView] = await Promise.all([
    goal ? loadForecast(goal).catch(() => null) : Promise.resolve(null),
    loadForecast({ period: monthPeriod }).catch(() => null),
  ]);
  const forecast = goalView?.forecast ?? null;
  const balance = (goalView ?? monthView)?.forecast.balance ?? null;
  return (
    <div className="space-y-3">
      <TodayCard
        today={
          forecast
            ? todayAllowance({
                capYen: forecast.safeDailyAllowance,
                spentTodayYen: goalView?.todaySpentYen ?? 0,
              })
            : null
        }
        outlook={
          goal && forecast
            ? {
                label: outlookLabel(goal.period),
                spentYen: forecast.breakdown.actualYen,
                p10: forecast.total.p10,
                p50: forecast.total.p50,
                p90: forecast.total.p90,
                budgetYen: goal.budgetYen,
              }
            : null
        }
        suggestion={forecast?.suggestion ?? null}
        probWithinBudget={forecast?.probWithinBudget ?? null}
        provisional={forecast?.provisional ?? false}
        monthKey={monthFrom.slice(0, 7)}
      />
      <HomeList
        balance={balance ? { p50: balance.p50, incomeYen: balance.incomeYen } : null}
        pendingCount={pendingCount}
        savings={savings}
      />
    </div>
  );
}
