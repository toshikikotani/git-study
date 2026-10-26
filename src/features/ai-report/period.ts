/**
 * AIのレポートの期間(本人「期間が目標期間になっておらず月末になっている」、ADR-135)。
 *
 * 今期の目標があれば、その期間(例:10/25〜11/24)で集計・診断・着地の見込みを作る。目標が無ければ、
 * いままでどおり暦の1か月(1日〜月末)。保存の鍵は期間の終わりの月('YYYY-MM')にする:レポートの表
 * (ai_monthly_reports)は月ごとに1行なので、10/25〜11/24 のレポートは「11月」に入る(暦の10月に
 * 作っていたレポートを上書きしない)。
 */

import { goalForecastArgs, type GoalForecastArgs } from '@/features/forecast/goal';
import { getCurrentPlan, listPlanRanges } from '@/features/spending-plan/store';
import { addDays, addMonths, nthDayOfMonth, todayJst, type DateOnly } from '@/lib/date';

export type ReportPeriod = {
  /** 保存の鍵(期間の終わりの月 'YYYY-MM')。 */
  key: string;
  range: { from: DateOnly; to: DateOnly };
  /** 画面と AI に見せる期間の名前(「10/25〜11/24」)。 */
  label: string;
  /** 今期の目標の期間なら、その予測の引数。暦の月なら null。 */
  goal: GoalForecastArgs | null;
};

/** 2026-10-25 → 10/25 */
const md = (date: DateOnly) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function periodLabel(range: { from: DateOnly; to: DateOnly }): string {
  return `${md(range.from)}〜${md(range.to)}`;
}

/** 目標(無ければ暦の月)から、レポートの期間を決める。 */
export function reportPeriodFrom(goal: GoalForecastArgs | null, today: DateOnly): ReportPeriod {
  const range =
    goal !== null && goal.period.from <= today && today <= goal.period.to
      ? goal.period
      : (() => {
          const from = nthDayOfMonth(today, 1);
          return { from, to: addDays(addMonths(from, 1), -1) };
        })();
  const isGoal = goal !== null && range === goal.period;
  return {
    key: range.to.slice(0, 7),
    range,
    label: periodLabel(range),
    goal: isGoal ? goal : null,
  };
}

export async function loadReportPeriod(now: Date = new Date()): Promise<ReportPeriod> {
  const today = todayJst(now);
  const plan = await getCurrentPlan(today).catch(() => null);
  return reportPeriodFrom(goalForecastArgs(plan), today);
}

/**
 * 保存したレポートの鍵('YYYY-MM')から、その期間を引く:その月に終わる目標があればその期間、
 * 無ければ暦の1か月(目標を使う前に作ったレポートも同じ鍵で読める)。
 */
export async function reportRangeOfKey(
  key: string,
): Promise<{ from: DateOnly; to: DateOnly; label: string }> {
  const plans = await listPlanRanges().catch(() => []);
  const plan = plans
    .filter((p) => p.periodEnd.slice(0, 7) === key)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const from = plan?.periodStart ?? `${key}-01`;
  const to = plan?.periodEnd ?? addDays(addMonths(`${key}-01`, 1), -1);
  return { from, to, label: periodLabel({ from, to }) };
}
