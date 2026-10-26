import { describe, expect, it } from 'vitest';

import { aiTrust } from '@/domain/ai-forecast-read';
import { buildUserContent, type MonthlyReportInput } from '@/features/ai-report/monthly-report-ai';
import { periodLabel, reportPeriodFrom } from '@/features/ai-report/period';
import type { GoalForecastArgs } from '@/features/forecast/goal';

/**
 * AIのレポートの期間(本人「期間が目標期間になっておらず月末になっている」、ADR-135)。
 */
const goal: GoalForecastArgs = {
  period: { from: '2026-10-25', to: '2026-11-24' },
  budgetYen: 120000,
  scope: {},
  categoryTargets: [],
};

describe('レポートの期間', () => {
  it('今期の目標があれば、その期間で作る(保存は期間の終わりの月)', () => {
    const p = reportPeriodFrom(goal, '2026-10-26');
    expect(p.range).toEqual({ from: '2026-10-25', to: '2026-11-24' });
    expect(p.key).toBe('2026-11');
    expect(p.label).toBe('10/25〜11/24');
    expect(p.goal).toBe(goal);
  });

  it('目標が無ければ、いままでどおり暦の1か月', () => {
    const p = reportPeriodFrom(null, '2026-10-26');
    expect(p.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(p.key).toBe('2026-10');
    expect(p.goal).toBeNull();
  });

  it('目標の期間の外の日なら、暦の1か月', () => {
    expect(reportPeriodFrom(goal, '2026-12-01').range).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('期間の名前', () => {
    expect(periodLabel({ from: '2026-01-25', to: '2026-02-24' })).toBe('1/25〜2/24');
  });
});

describe('AI に渡す文', () => {
  const input = (period: MonthlyReportInput['period']): MonthlyReportInput => ({
    monthKey: period.to.slice(0, 7),
    period,
    totalSpentYen: 50000,
    totalIncomeYen: 0,
    wasteYen: 0,
    necessaryYen: 0,
    wasteRatio: null,
    undiagnosedCount: 0,
    categoryBreakdown: [],
    topWasteItems: [],
    topNecessaryItems: [],
    wasteRatioTrend: [],
    savings: { totalYen: 0, thisMonthYen: 0, paceYen: null, nextGoal: null },
    forecast: {
      asOf: '2026-10-26',
      remainingDays: 29,
      knownYen: 50000,
      p10: 90000,
      p50: 100000,
      p90: 115000,
      unrecordedYen: 0,
      billsYen: 0,
      visitsYen: 0,
      specialYen: 0,
      remainingPerDayYen: 1700,
      recentPerDayYen: null,
      provisional: false,
      categories: [],
      breakdown: null,
    },
    evidence: {
      dayOffAvgYen: 3000,
      weekdayAvgYen: 2000,
      notable: [],
      scheduled: [],
      calendar: null,
      pastReads: [],
      trust: aiTrust([]),
    },
  });

  it('今期の目標なら、目標の期間と「期間の終わり」を伝える(月末と言わない)', () => {
    const text = buildUserContent(
      input({ from: '2026-10-25', to: '2026-11-24', label: '10/25〜11/24', isGoal: true }),
    );
    expect(text).toContain('今期の目標の期間 2026-10-25〜2026-11-24 の家計データ');
    expect(text).toContain('この期間の終わり 2026-11-24 の見込み');
    expect(text).toContain('この期間の休み日・平日別支出');
    expect(text).not.toContain('月末');
  });

  it('暦の月なら、いままでどおり', () => {
    const text = buildUserContent(
      input({ from: '2026-10-01', to: '2026-10-31', label: '10/1〜10/31', isGoal: false }),
    );
    expect(text).toContain('2026-10 の家計データ');
    expect(text).toContain('今月の休み日・平日別支出');
  });
});
