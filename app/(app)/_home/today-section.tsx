import { todayAllowance } from '@/domain/forecast/today';
import { calendarContext } from '@/domain/forecast/calendar';
import { loadTodayForecasts, todayCapYen } from '@/features/home/today-forecasts';
import { daysBetween, splitDateOnly } from '@/lib/date';
import { SavingsCard } from './savings-card';
import { WhatIfButton } from './what-if-sheet';
import { shortDate, TodayCard } from './today-card';

/** 「10月の見通し」(暦の1か月の目標)/「10月14日までの見通し」(それ以外)。 */
export function outlookLabel(period: { from: string; to: string }): string {
  const [, fm, fd] = splitDateOnly(period.from);
  const [ty, tm, td] = splitDateOnly(period.to);
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (fd === 1 && fm === tm && td === lastDay) return `${tm}月の見通し`;
  return `${tm}月${td}日までの見通し`;
}

/** 2026-10-31 → 10月31日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/**
 * ホームの「今日使える目安」から「貯金」まで(デザイン仕様書の「今日」、ADR-090)を読み込む(重い予測
 * なので、ホームの他の部分を待たせないように Suspense の中で読む)。今日使える目安・今期の見通し・
 * 次の一手は目標の範囲。月末に残る見込みは今月のすべての支出と収入。
 * 予測はAIの窓口と同じところ(loadTodayForecasts、ADR-106)から受け取る。
 */
export async function TodaySection({
  savingsNowYen,
  upcoming,
}: {
  savingsNowYen: number | null;
  /** 今期の見通しと貯金のあいだに出す「これからの支払い」(デザイン v3-1)。 */
  upcoming?: React.ReactNode;
}) {
  const { today, monthPeriod, goal, goalView, monthView, payday, monthlySavingsTargetYen } =
    await loadTodayForecasts();
  const forecast = goalView?.forecast ?? null;
  const balance = monthView?.forecast.balance ?? null;
  // 残りの休日数を計算
  const periodTo = goal?.period.to ?? monthPeriod.to;
  const cal = forecast ? calendarContext(today, periodTo, payday) : null;
  const capYen = goalView ? todayCapYen(goalView) : 0;

  return (
    <>
      <TodayCard
        today={
          forecast && goal
            ? todayAllowance({
                capYen,
                spentTodayYen: goalView?.todaySpentYen ?? 0,
              })
            : null
        }
        allowanceExplain={
          forecast && goal
            ? {
                budgetYen: goal.budgetYen,
                spentYen: forecast.breakdown.actualYen,
                spentTodayYen: goalView?.todaySpentYen ?? 0,
                remainingDays: forecast.remainingDays,
                capYen,
                probWithinBudget: forecast.probWithinBudget,
                remainingDayOffs: cal?.dayOffs,
                dayOffPerDayYen: goalView?.dayOffPerDayYen ?? null,
                weekdayPerDayYen: goalView?.weekdayPerDayYen ?? null,
                dailyLimit: goalView?.dailyLimit ?? null,
                scheduledYen: forecast.committed?.scheduledYen ?? 0,
                fixedYen: forecast.committed?.fixedYen ?? 0,
              }
            : null
        }
        outlook={
          goal && forecast
            ? {
                periodLabel: `${shortDate(goal.period.from)}〜${shortDate(goal.period.to)} · 残り${Math.max(0, daysBetween(today, goal.period.to) + 1)}日`,
                spentYen: forecast.breakdown.actualYen,
                p10: forecast.total.p10,
                p50: forecast.total.p50,
                p90: forecast.total.p90,
                budgetYen: goal.budgetYen,
              }
            : null
        }
        probWithinBudget={forecast?.probWithinBudget ?? null}
        provisional={forecast?.provisional ?? false}
        tomorrowYen={goalView?.tomorrowLimit?.todayLimitYen ?? null}
        daysAfterToday={Math.max(0, daysBetween(today, periodTo))}
        todayTopNames={goalView?.todayTopSpends.map((s) => s.name) ?? []}
        whatIf={goal && forecast ? <WhatIfButton /> : null}
      />
      {upcoming}
      <SavingsCard
        untilLabel={`${dayLabel(monthPeriod.to)}まで`}
        balance={balance ? { p50: balance.p50, incomeYen: balance.incomeYen } : null}
        monthlyTargetYen={monthlySavingsTargetYen}
        nowYen={savingsNowYen}
      />
    </>
  );
}
