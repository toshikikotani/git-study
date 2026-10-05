import { describe, expect, it } from 'vitest';

import { buildForecast } from '@/domain/forecast/engine';
import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { eachDay } from '@/domain/period';

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'dining',
    genreName: '外食',
    status: 'actual',
    kind: 'normal',
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: 'x',
    ...o,
  };
}

const daily = (from: string, to: string, genreId: string, genreName: string, yen: number) =>
  eachDay(from, to).map((d) => tx({ occurredOn: d, amountYen: -yen, genreId, genreName }));

const base = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  today: '2026-10-15',
  trainingFrom: '2026-07-01',
  recordStart: '2026-07-01',
  confirmedFixedKeys: new Set<string>(),
  detectedSubscriptions: [],
  budgetYen: null,
  payday: 25,
  dataVersion: 'v',
  trials: 600,
};

const data = [
  ...daily('2026-07-01', '2026-10-15', 'dining', '外食', 1000),
  ...daily('2026-07-01', '2026-10-15', 'hobby', '娯楽', 500),
  tx({ occurredOn: '2026-10-10', amountYen: -50000, genreId: 'dining', kind: 'special' }),
];

describe('buildForecast の範囲(scope)と目標(categoryTargets)', () => {
  it('ジャンルを指定すると、そのジャンルだけを数える', () => {
    const all = buildForecast({ ...base, transactions: data });
    const only = buildForecast({
      ...base,
      transactions: data,
      scope: { genreIds: new Set(['dining']) },
    });
    expect(only.total.p50).toBeLessThan(all.total.p50);
    expect(only.byCategory.map((c) => c.categoryId)).toEqual(['dining']);
  });

  it('特別費を除く指定では、特別費の実績が着地に入らない', () => {
    const withSpecial = buildForecast({ ...base, transactions: data });
    const without = buildForecast({
      ...base,
      transactions: data,
      scope: { excludeSpecial: true },
    });
    expect(without.total.p50).toBeLessThan(withSpecial.total.p50);
  });

  it('目標を渡すと、ジャンルごとに「超える確率」が出て、目標が低いほど高い', () => {
    const run = (target: number) =>
      buildForecast({
        ...base,
        transactions: data,
        scope: { genreIds: new Set(['dining']), excludeSpecial: true },
        categoryTargets: [{ categoryId: 'dining', categoryName: '外食', targetYen: target }],
      }).byCategory[0]!;
    const low = run(20000);
    const high = run(60000);
    expect(low.exceedance).toBeGreaterThan(0.9);
    expect(high.exceedance).toBeLessThan(0.1);
    expect(low.targetYen).toBe(20000);
  });

  it('実績・予定・固定費の内訳と、着地(実績+残り)をジャンルごとに返す', () => {
    const withScheduled = [
      ...data,
      tx({
        occurredOn: '2026-10-20',
        amountYen: -3000,
        status: 'scheduled',
        genreId: 'hobby',
        genreName: '娯楽',
      }),
    ];
    const forecast = buildForecast({ ...base, transactions: withScheduled });
    const hobby = forecast.byCategory.find((c) => c.categoryId === 'hobby')!;
    expect(hobby.scheduledYen).toBe(3000);
    expect(hobby.actualYen).toBe(500 * 15);
    expect(hobby.baseYen).toBe(hobby.actualYen + 3000);
    expect(hobby.landing.p50).toBeGreaterThanOrEqual(hobby.baseYen);
    expect(hobby.landing.p10).toBeLessThanOrEqual(hobby.landing.p50);
    expect(hobby.landing.p50).toBeLessThanOrEqual(hobby.landing.p70);
    expect(hobby.landing.p70).toBeLessThanOrEqual(hobby.landing.p90);
  });

  it('同じ入力なら、同じ結果になる(決定論)', () => {
    const a = buildForecast({ ...base, transactions: data });
    const b = buildForecast({ ...base, transactions: data });
    expect(a.total).toEqual(b.total);
  });
});

describe('buildForecast の規則的な来店', () => {
  const weekly = eachDay('2026-07-04', '2026-10-15')
    .filter((d) => new Date(d).getUTCDay() === 6)
    .map((d) =>
      tx({
        occurredOn: d,
        amountYen: -5000,
        genreId: 'food',
        genreName: '食料品',
        merchantName: 'スーパーさくら',
      }),
    );

  it('毎週通う店は来店の見込みとして別に出て、期待額が入る', () => {
    const forecast = buildForecast({ ...base, transactions: weekly });
    expect(forecast.visits.merchants[0]).toMatchObject({ label: 'スーパーさくら', everyDays: 7 });
    expect(forecast.visits.expectedYen).toBeGreaterThan(5000);
  });

  it('残りの土曜(約2回)ぶんの着地が、規則的な額に近い(日ごとの確率で均して大きくぶれない)', () => {
    const forecast = buildForecast({ ...base, transactions: weekly });
    const food = forecast.byCategory.find((c) => c.categoryId === 'food')!;
    // 実績 10/3,10/10 の 2 回 + 残り 10/17,24,31 の 3 回が来る(1回5,000円、来る確率は9割台)
    expect(food.landing.p50).toBeGreaterThanOrEqual(20000);
    expect(food.landing.p50).toBeLessThanOrEqual(30000);
    expect(food.landing.p90 - food.landing.p10).toBeLessThan(12000);
  });
});

describe('buildForecast の金額は整数の円(画面の formatYen は小数だと例外にする、ADR-008)', () => {
  const ints = (n: number) => Number.isInteger(n);
  const allAmounts = (f: ReturnType<typeof buildForecast>): number[] => [
    f.total.p10,
    f.total.p50,
    f.total.p70,
    f.total.p90,
    f.total.mean,
    f.expectedOvershoot,
    f.special.expected,
    f.special.p90,
    ...f.byCategory.flatMap((c) => [
      c.p10,
      c.p50,
      c.p90,
      c.landing.p10,
      c.landing.p50,
      c.landing.p70,
      c.landing.p90,
      c.baseYen,
    ]),
  ];

  it('幅の補正が無いとき', () => {
    const f = buildForecast({ ...base, budgetYen: 40000, transactions: data });
    expect(allAmounts(f).every(ints)).toBe(true);
  });

  it('幅の補正(1以外の係数)があるとき', () => {
    const f = buildForecast({
      ...base,
      budgetYen: 40000,
      transactions: data,
      calibration: { widthFactor: 1.2371, sampleSize: 20, centerFactor: 1.1 },
    });
    expect(allAmounts(f).every(ints)).toBe(true);
    expect(f.total.p10).toBeLessThanOrEqual(f.total.p50);
    expect(f.total.p50).toBeLessThanOrEqual(f.total.p70);
    expect(f.total.p70).toBeLessThanOrEqual(f.total.p90);
  });
});

describe('「予測を止める」にしたジャンル', () => {
  const input = {
    ...base,
    budgetYen: 60000,
    transactions: [
      ...daily('2026-07-01', '2026-10-15', 'dining', '外食', 1000),
      ...daily('2026-07-01', '2026-10-15', 'tax', '保険・税金・手数料', 800),
    ],
  };

  it('残りの変動費は予測しない。実績は数え、着地の幅は実績のまま動かない', () => {
    const f = buildForecast({ ...input, noForecastGenreIds: new Set(['tax']) });
    const tax = f.byCategory.find((c) => c.categoryId === 'tax')!;
    expect(tax.actualYen).toBe(800 * 15);
    expect(tax.landing.p10).toBe(tax.baseYen);
    expect(tax.landing.p90).toBe(tax.baseYen);
  });

  it('超過の原因(drivers)に出てこない', () => {
    const f = buildForecast({ ...input, budgetYen: 30000, noForecastGenreIds: new Set(['tax']) });
    expect(f.drivers.map((d) => d.categoryId)).not.toContain('tax');
  });

  it('止めていないジャンルの予測は、そのまま出る', () => {
    const f = buildForecast({ ...input, noForecastGenreIds: new Set(['tax']) });
    const dining = f.byCategory.find((c) => c.categoryId === 'dining')!;
    expect(dining.landing.p90).toBeGreaterThan(dining.baseYen);
  });

  it('止めたぶん、全体の着地が小さくなる', () => {
    const all = buildForecast(input);
    const stopped = buildForecast({ ...input, noForecastGenreIds: new Set(['tax']) });
    expect(stopped.total.p50).toBeLessThan(all.total.p50);
  });
});
