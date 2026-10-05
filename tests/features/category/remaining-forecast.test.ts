import { describe, expect, it } from 'vitest';

import { remainingOfCategory, remainingOfTotal } from '@/domain/forecast/remaining';
import type { Forecast } from '@/domain/forecast/types';
import { buildCategoryLines, type CategoryTx } from '@/features/category/model';
import { buildCumulative } from '@/features/category/pace';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-10-06';
const tx = (id: string, occurredOn: string, yen: number, status?: 'scheduled'): CategoryTx => ({
  ...ledgerTx({
    id,
    occurredOn,
    genreId: 'dining',
    amountYen: -yen,
    ...(status ? { status } : {}),
  }),
  items: [],
});
const lines = buildCategoryLines(
  [
    tx('a', '2026-10-01', 3000),
    tx('b', '2026-10-03', 4000),
    tx('c', '2026-10-05', 8599),
    tx('d', '2026-10-20', 5000, 'scheduled'),
  ],
  'dining',
  { from: '2026-10-01', to: '2026-10-31' },
  TODAY,
);

const chart = (remaining?: { lowYen: number; medianYen: number; highYen: number } | null) =>
  buildCumulative({
    lines,
    monthStart: '2026-10-01',
    monthEnd: '2026-10-31',
    today: TODAY,
    recordStart: '2026-10-01',
    goal: null,
    ...(remaining !== undefined ? { remaining } : {}),
  });

describe('buildCumulative は確率予測の「残りの支出」で予測の線を描く', () => {
  const remaining = { lowYen: 8000, medianYen: 20000, highYen: 35000 };

  it('最終日の予測は、今日の実績 + 予定 + 残りの中央値。帯は下限・上限', () => {
    const c = chart(remaining);
    const last = c.days.at(-1)!;
    expect(last.date).toBe('2026-10-31');
    expect(last.forecastYen).toBe(15599 + 5000 + 20000);
    expect(last.forecastLowYen).toBe(15599 + 5000 + 8000);
    expect(last.forecastHighYen).toBe(15599 + 5000 + 35000);
  });

  it('日平均の延長(15,599円 ÷ 日数 × 残り日数)にはならない', () => {
    const naive = chart();
    const engine = chart(remaining);
    expect(naive.days.at(-1)!.forecastYen!).toBeGreaterThan(
      engine.days.at(-1)!.forecastYen! + 20000,
    );
  });

  it('予定の日(10/20)に、予定の額が段差として足される', () => {
    const c = chart(remaining);
    const before = c.days.find((d) => d.date === '2026-10-19')!.forecastYen!;
    const on = c.days.find((d) => d.date === '2026-10-20')!.forecastYen!;
    expect(on - before).toBeGreaterThanOrEqual(5000);
  });

  it('日が進むほど、線は増え、帯は広がる', () => {
    const c = chart(remaining);
    const future = c.days.filter((d) => d.date > TODAY);
    for (let i = 1; i < future.length; i += 1) {
      expect(future[i]!.forecastYen!).toBeGreaterThanOrEqual(future[i - 1]!.forecastYen!);
    }
    const width = (i: number) => future[i]!.forecastHighYen! - future[i]!.forecastLowYen!;
    expect(width(future.length - 1)).toBeGreaterThan(width(0));
  });

  it('渡さなければ、これまでどおり日平均の延長', () => {
    const c = chart(null);
    expect(c.days.at(-1)!.forecastYen).toBeGreaterThan(40000);
  });

  it('予測を止める(holdForecast)ときは、残りを足さない', () => {
    const c = buildCumulative({
      lines,
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
      today: TODAY,
      recordStart: '2026-10-01',
      goal: null,
      holdForecast: true,
      remaining: null,
    });
    expect(c.days.at(-1)!.forecastYen).toBe(15599 + 5000);
  });
});

describe('remainingOfTotal / remainingOfCategory', () => {
  const forecast = {
    actualYen: 15599,
    committed: { scheduledYen: 5000, fixedYen: 0 },
    total: { p10: 30000, p50: 45000, p70: 50000, p90: 62000, mean: 46000 },
    path: [{ date: '2026-10-31', p10: 14401, p50: 29401, p90: 46401 }],
    typicalProfile: [],
    byCategory: [
      {
        categoryId: 'dining',
        actualYen: 15599,
        scheduledYen: 5000,
        landing: { p10: 30000, p50: 45000, p70: 50000, p90: 62000 },
      },
    ],
  } as unknown as Forecast;

  it('着地から、実績と予定を引いた額(残りの支出)を返す', () => {
    expect(remainingOfTotal(forecast)).toMatchObject({
      lowYen: 9401,
      medianYen: 24401,
      highYen: 41401,
      path: [{ date: '2026-10-31', lowYen: 14401, medianYen: 29401, highYen: 46401 }],
    });
    expect(remainingOfCategory(forecast, 'dining')).toMatchObject({
      lowYen: 9401,
      medianYen: 24401,
      highYen: 41401,
    });
  });

  it('予測にないカテゴリは null。負にはならない', () => {
    expect(remainingOfCategory(forecast, 'none')).toBeNull();
    const over = { ...forecast, total: { ...forecast.total, p10: 1000 } } as Forecast;
    expect(remainingOfTotal(over).lowYen).toBe(0);
  });
});
