import { describe, expect, it } from 'vitest';

import { reportInsights } from '@/domain/report-insights';
import type { Forecast, ForecastCategoryBand } from '@/domain/forecast/types';

const band = (over: Partial<ForecastCategoryBand> = {}): ForecastCategoryBand => ({
  categoryId: 'dining',
  categoryName: '外食',
  p10: 0,
  p50: 0,
  p90: 0,
  landing: { p10: 20000, p50: 30000, p70: 33000, p90: 40000 },
  baseYen: 10000,
  actualYen: 10000,
  scheduledYen: 0,
  fixedYen: 0,
  targetYen: null,
  exceedance: null,
  ...over,
});

const forecast = (over: Partial<Forecast> = {}): Forecast => ({
  periodId: 'p',
  asOf: '2026-10-10',
  remainingDays: 20,
  total: { p10: 80000, p50: 100000, p70: 108000, p90: 120000, mean: 100000 },
  byCategory: [band()],
  committed: { scheduledYen: 0, fixedYen: 0 },
  actualYen: 0,
  visits: { expectedYen: 0, merchants: [] },
  pace: { remainingYen: 0, perDayYen: null, recentPerDayYen: null },
  seasonal: { active: false, periodFactor: null },
  special: { expected: 0, p90: 0 },
  probWithinBudget: null,
  expectedOvershoot: 0,
  drivers: [],
  safeDailyAllowance: null,
  status: 'ready',
  dataDays: 120,
  path: [],
  typicalProfile: [],
  bills: { expectedYen: 0, items: [] },
  unrecordedYen: 0,
  phase: 'mid',
  provisional: false,
  balance: null,
  calibration: null,
  ...over,
});

describe('reportInsights', () => {
  it('予算に収まる確率が高ければ、足りると伝える', () => {
    const out = reportInsights({
      forecast: forecast({ probWithinBudget: 0.9 }),
      budgetYen: 130000,
      periodLabel: '今月',
    });
    const budget = out.find((i) => i.key === 'budget')!;
    expect(budget.tone).toBe('info');
    expect(budget.text).toContain('90%');
  });

  it('収まる確率が低ければ、超える平均額と1日の上限(次の一手)を数字で出す', () => {
    const out = reportInsights({
      forecast: forecast({
        probWithinBudget: 0.35,
        expectedOvershoot: 12340,
        safeDailyAllowance: 2480,
      }),
      budgetYen: 90000,
      periodLabel: '今月',
    });
    const budget = out.find((i) => i.key === 'budget')!;
    expect(budget.tone).toBe('caution');
    expect(budget.text).toContain('35%');
    expect(budget.text).toContain('12,300円');
    expect(budget.text).toContain('1日 2,500円');
    expect(budget.text).not.toMatch(/ダメ|失敗|使いすぎ/);
  });

  it('先の期間より増えるジャンルを、増える額と前後の額で示す', () => {
    const out = reportInsights({
      forecast: forecast(),
      budgetYen: null,
      periodLabel: '今月',
      previousByGenre: new Map([['dining', 20000]]),
      previousLabel: '先月',
    });
    const inc = out.find((i) => i.key === 'increase')!;
    expect(inc.text).toContain('外食は先月より 10,000円 増える見込み');
    expect(inc.text).toContain('20,000円 → 30,000円');
  });

  it('増え方が小さいジャンルは出さない', () => {
    const out = reportInsights({
      forecast: forecast(),
      budgetYen: null,
      periodLabel: '今月',
      previousByGenre: new Map([['dining', 29000]]),
    });
    expect(out.find((i) => i.key === 'increase')).toBeUndefined();
  });

  it('予定と固定費がもう決まっている割合を出す', () => {
    const out = reportInsights({
      forecast: forecast({ committed: { scheduledYen: 20000, fixedYen: 30000 } }),
      budgetYen: null,
      periodLabel: '今月',
    });
    expect(out.find((i) => i.key === 'committed')!.text).toContain('50,000円');
    expect(out.find((i) => i.key === 'committed')!.text).toContain('着地の50%');
  });

  it('規則的に通う店と、季節と、中心の補正を知らせる', () => {
    const out = reportInsights({
      forecast: forecast({
        visits: {
          expectedYen: 14000,
          merchants: [{ label: 'スーパーさくら', everyDays: 7, probability: 0.88, meanYen: 4800 }],
        },
        seasonal: { active: true, periodFactor: 1.25 },
        calibration: {
          centerByPhase: { early: 1, mid: 1.12, late: 1 },
          pit: [],
          pitByPhase: { early: [], mid: [], late: [] },
          pitWeight: 0.5,
          months: 6,
          sampleSize: 12,
        },
      }),
      budgetYen: null,
      periodLabel: '今月',
    });
    expect(out.find((i) => i.key === 'visits')!.text).toContain('約7日おき');
    expect(out.find((i) => i.key === 'season')!.text).toContain('25%多い');
    expect(out.find((i) => i.key === 'center')!.text).toContain('12%ほど多かった');
  });

  it('記録が短いときは、幅が広い理由を最初に伝える', () => {
    const out = reportInsights({
      forecast: forecast({ status: 'learning', dataDays: 6 }),
      budgetYen: null,
      periodLabel: '今月',
    });
    expect(out[0]!.key).toBe('learning');
    expect(out[0]!.text).toContain('6日');
  });

  it('記録の遅れと、月払いの請求と、検証の月が少ないときの目安を知らせる', () => {
    const out = reportInsights({
      forecast: forecast({
        unrecordedYen: 4300,
        bills: { expectedYen: 7200, items: [{ label: 'でんき', meanYen: 7200 }] },
        provisional: true,
      }),
      budgetYen: null,
      periodLabel: '今月',
    });
    expect(out.find((i) => i.key === 'unrecorded')!.text).toContain('4,300円');
    expect(out.find((i) => i.key === 'bills')!.text).toContain('でんき');
    expect(out.find((i) => i.key === 'provisional')!.text).toContain('目安');
  });

  it('予算に収まる確率は、99%以上・1%未満と言い切らずに出す', () => {
    const text = (p: number) =>
      reportInsights({
        forecast: forecast({ probWithinBudget: p, expectedOvershoot: 1000 }),
        budgetYen: 50000,
        periodLabel: '今月',
      }).find((i) => i.key === 'budget')!.text;
    expect(text(0.999)).toContain('99%以上');
    expect(text(0.001)).toContain('1%未満');
    expect(text(0.85)).toContain('85%');
  });

  it('多くても6件まで', () => {
    const out = reportInsights({
      forecast: forecast({
        status: 'learning',
        dataDays: 5,
        probWithinBudget: 0.3,
        expectedOvershoot: 5000,
        safeDailyAllowance: 1000,
        committed: { scheduledYen: 1000, fixedYen: 1000 },
        visits: {
          expectedYen: 1000,
          merchants: [{ label: 'A', everyDays: 7, probability: 0.9, meanYen: 1000 }],
        },
        seasonal: { active: true, periodFactor: 1.3 },
        drivers: [{ categoryId: 'dining', categoryName: '外食', shareOfRisk: 0.8 }],
        calibration: {
          centerByPhase: { early: 1, mid: 1, late: 1 },
          pit: [],
          pitByPhase: { early: [], mid: [], late: [] },
          pitWeight: 0.5,
          months: 6,
          sampleSize: 12,
        },
      }),
      budgetYen: 50000,
      periodLabel: '今月',
      previousByGenre: new Map([['dining', 5000]]),
    });
    expect(out.length).toBeLessThanOrEqual(6);
  });
});

describe('reportInsights の残りの見込みと直近のペース', () => {
  it('残りの見込み(合計と1日あたり)と、直近14日の1日あたりを並べて出す', () => {
    const out = reportInsights({
      forecast: forecast({
        remainingDays: 26,
        pace: { remainingYen: 35000, perDayYen: 1346, recentPerDayYen: 1500 },
      }),
      budgetYen: null,
      periodLabel: '今月',
    });
    const pace = out.find((i) => i.key === 'pace')!;
    expect(pace.tone).toBe('info');
    expect(pace.text).toContain('残り26日');
    expect(pace.text).toContain('約35,000円');
    expect(pace.text).toContain('1日あたり約1,300円');
    expect(pace.text).toContain('直近14日の1日あたりは約1,500円');
  });

  it('見込みが直近のペースよりかなり低いときは、上振れしやすいと知らせる', () => {
    const out = reportInsights({
      forecast: forecast({
        remainingDays: 26,
        pace: { remainingYen: 26000, perDayYen: 1000, recentPerDayYen: 2800 },
      }),
      budgetYen: null,
      periodLabel: '今月',
    });
    const pace = out.find((i) => i.key === 'pace')!;
    expect(pace.tone).toBe('caution');
    expect(pace.text).toContain('上振れしやすい');
  });

  it('残りが無い・見込みが0なら出さない', () => {
    const out = reportInsights({
      forecast: forecast({
        remainingDays: 0,
        pace: { remainingYen: 0, perDayYen: null, recentPerDayYen: null },
      }),
      budgetYen: null,
      periodLabel: '今月',
    });
    expect(out.find((i) => i.key === 'pace')).toBeUndefined();
  });
});
