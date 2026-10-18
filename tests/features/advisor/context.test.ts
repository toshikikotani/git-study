import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { ForecastView } from '@/features/forecast/load';
import type { TodayForecasts } from '@/features/home/today-forecasts';

const loadTodayForecasts = vi.fn();
const loadHomeSummary = vi.fn();
vi.mock('@/features/home/today-forecasts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/today-forecasts')>()),
  loadTodayForecasts: (now: Date) => loadTodayForecasts(now),
}));
vi.mock('@/features/home/summary', () => ({
  loadHomeSummary: (now: Date) => loadHomeSummary(now),
}));

import {
  buildAdvisorContextText,
  formatTodayNumbers,
  todayNumbersOf,
} from '@/features/advisor/context';

/**
 * AIに渡す「今の状況」(ADR-106)。ホームの「今日」と同じ予測から、発言のたびに計算し直す。
 * 数字は本人の画面写真(2026-10-17)のもの:今日の目安を9,391円超え、今期は目標17.2万円に対して
 * 着地約20.8万円・目標内の確率1%、月末に残る見込み+8.2万円(収入27.5万 − 支出19.3万)。
 */

const NOW = new Date('2026-10-16T23:22:00Z'); // 日本時間 2026-10-17 08:22

/** カテゴリの予測の行(使った額・目標・見込み)。 */
function band(
  id: string,
  name: string,
  actualYen: number,
  targetYen: number,
  p50: number,
  type = 'steady',
) {
  return {
    categoryId: id,
    categoryName: name,
    p10: 0,
    p50: p50 - actualYen,
    p90: p50 - actualYen,
    landing: { p10: p50, p50, p90: p50 + 1_000 },
    baseYen: actualYen,
    actualYen,
    scheduledYen: 0,
    fixedYen: 0,
    targetYen,
    exceedance: p50 > targetYen ? 0.9 : 0.1,
    meanYen: 0,
    expectedCount: 0,
    type,
  };
}

function forecasts(): TodayForecasts {
  const goalView = {
    forecast: {
      safeDailyAllowance: 3_000,
      provisional: true,
      probWithinBudget: 0.01,
      total: { p10: 199_000, p50: 208_000, p90: 216_000 },
      breakdown: { actualYen: 147_000 },
      committed: { scheduledYen: 6_000, fixedYen: 12_000 },
      suggestion: null,
      remainingDays: 20,
      byCategory: [
        band('dining', '外食', 22_000, 20_000, 25_000),
        band('food', '食料品', 33_000, 40_000, 38_000),
        band('rent', '家賃', 80_000, 80_000, 80_000, 'fixed'),
        band('cafe', 'カフェ', 2_000, 10_000, 4_000),
      ],
    },
    excludedByCategory: new Map(),
    closedGenreIds: new Set(),
    cautionPrecision: null,
    todaySpentYen: 10_391,
    dailyLimit: { todayLimitYen: 1_000 },
  } as unknown as ForecastView;
  const monthView = {
    forecast: { balance: { incomeYen: 275_000, p50: 82_000 } },
  } as unknown as ForecastView;
  return {
    today: '2026-10-17',
    monthPeriod: { from: '2026-10-01', to: '2026-10-31' },
    goal: {
      period: { from: '2026-10-01', to: '2026-11-05' },
      budgetYen: 172_000,
      scope: {},
      categoryTargets: [],
    },
    goalView,
    monthView,
    payday: 25,
    monthlySavingsTargetYen: 100_000,
  };
}

describe('ホームの「今日」と同じ数字をAIに渡す(ADR-106)', () => {
  const text = formatTodayNumbers(todayNumbersOf(forecasts(), NOW)).join('\n');

  it('計算した時刻をつけ、最新の値だと書く', () => {
    expect(text).toContain('2026-10-17 08:22 に明細から計算し直した最新の値');
  });

  it('今日使える目安:ホームと同じ1日の上限(休日軸の上限)から、今日使った額を引く', () => {
    expect(text).toContain('今日使える目安(記録が少ないので仮)');
    expect(text).toContain('今日はもう上限を9,391円超えている');
  });

  it('今期の見通し:目標・使った額・着地見込み・超えそうな額・確率・予定と固定費', () => {
    expect(text).toContain('今期の見通し(2026-10-01〜2026-11-05、今日を入れて残り20日)');
    expect(text).toContain('目標172,000円、今日までに使った額147,000円');
    expect(text).toContain('着地見込み約20.8万円');
    expect(text).toContain('目標を約3.6万円こえそう');
    expect(text).toContain('目標内に収まる確率1%');
    expect(text).toContain('これから払う予定6,000円と固定費12,000円');
  });

  it('月末に残る見込み:収入 − 支出の見込み', () => {
    expect(text).toContain(
      '月末(2026-10-31)に残る見込み: +8.2万円(収入27.5万円 − 支出の見込み約19.3万円)',
    );
  });

  it('毎月の貯金目標(ホームと同じ値)と、月末の見込みとの差', () => {
    expect(text).toContain(
      '毎月の貯金目標100,000円(ホームの貯金と同じ値): 月末の見込みでは、あと約1.8万円届かない',
    );
  });

  it('気をつけたいカテゴリ(ホームと同じ、こえた → 8割をこえた。固定費・順調は出さない、ADR-117)', () => {
    expect(text).toContain(
      '- 気をつけたいカテゴリ(ホームに出しているもの): 外食は目標をこえた(使った額22,000円/目標20,000円、見込み約2.5万円)、食料品は目標の8割をこえた(使った額33,000円/目標40,000円、見込み約3.8万円)',
    );
    expect(text).not.toContain('家賃は');
    expect(text).not.toContain('カフェは');
    expect(text).not.toContain('ホームに出すと決めたカテゴリ');
  });

  it('目標が無ければ、今日の目安と見通しは出していないと書く', () => {
    const none = formatTodayNumbers(
      todayNumbersOf({ ...forecasts(), goal: null, goalView: null, monthView: null }, NOW),
    ).join('\n');
    expect(none).toContain('今期の目標が無いので出していない');
    expect(none).not.toContain('今期の見通し');
    expect(none).toContain('今月の収入の記録が無いので出していない');
  });
});

describe('発言のたびに読み直す(作り置きしない、ADR-106)', () => {
  it('呼ぶたびに予測と集計を読み直す', async () => {
    loadTodayForecasts.mockResolvedValue(forecasts());
    loadHomeSummary.mockResolvedValue({
      savings: { thisMonthYen: 128_122, paceYen: -12_036, startOn: null, totalYen: 0, goals: [] },
      tiles: [],
    });
    const first = await buildAdvisorContextText(NOW);
    await buildAdvisorContextText(NOW);
    expect(loadTodayForecasts).toHaveBeenCalledTimes(2);
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
    expect(first).toContain('今日はもう上限を9,391円超えている');
    expect(first).toContain('今月これまで(今日までの収入 − 支出。月末の見込みではない): 128,122円');
  });

  it('予測が読めなくても、集計だけで続ける', async () => {
    loadTodayForecasts.mockRejectedValueOnce(new Error('x'));
    const text = await buildAdvisorContextText(NOW);
    expect(text).toContain('今月これまで');
    expect(text).not.toContain('今日使える目安');
  });

  it('ホームとAIは同じ読み込み(loadTodayForecasts)を使い、AIの側は作り置きしない', () => {
    const section = readFileSync('app/(app)/_home/today-section.tsx', 'utf8');
    expect(section).toContain('await loadTodayForecasts()');
    const context = readFileSync('src/features/advisor/context.ts', 'utf8');
    expect(context).not.toMatch(/unstable_cache|'use cache'/);
  });
});
