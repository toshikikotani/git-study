/** まとまり型(設計書 v3 4.1):出来事にまとめる・前回からの日数・予定が主役。 */
import { describe, expect, it } from 'vitest';

import { lumpyCategories, type ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecast } from '@/domain/forecast/engine';
import { eachDay } from '@/domain/period';
import { addDays } from '@/lib/date';

function tx(
  o: Partial<ForecastSourceTransaction> & { occurredOn: string; amountYen: number },
): ForecastSourceTransaction {
  return {
    genreId: 'travel',
    genreName: '旅行',
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

/** 3日間の旅行(電車・宿・食事)。 */
const trip = (start: string): ForecastSourceTransaction[] => [
  tx({ occurredOn: start, amountYen: -25000 }),
  tx({ occurredOn: start, amountYen: -20000 }),
  tx({ occurredOn: addDays(start, 1), amountYen: -4000 }),
  tx({ occurredOn: addDays(start, 2), amountYen: -3000 }),
];

describe('lumpyCategories', () => {
  it('3日以内の支払いを1つの出来事にまとめ、前回からの日数を数える', () => {
    const out = lumpyCategories({
      transactions: [...trip('2026-03-10'), ...trip('2026-08-01')],
      from: '2026-01-01',
      today: '2026-08-20',
      scheduled: [],
      categoryTypes: { travel: 'lumpy' },
      nameOf: new Map([['travel', '旅行']]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.eventLogAmounts.map((v) => Math.round(Math.exp(v)))).toEqual([52000, 52000]);
    expect(out[0]!.daysSinceLast).toBe(17);
    expect(out[0]!.hasScheduled).toBe(false);
  });
});

describe('まとまり型の予測', () => {
  const daily = eachDay('2025-10-01', '2026-09-30').map((d) =>
    tx({ occurredOn: d, amountYen: -1200, genreId: 'dining', genreName: '外食' }),
  );
  const forecastWith = (
    trips: ForecastSourceTransaction[],
    extra: ForecastSourceTransaction[] = [],
  ) =>
    buildForecast({
      transactions: [...daily, ...trips, ...extra],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-01',
      trainingFrom: '2025-10-01',
      recordStart: '2025-10-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: null,
      payday: 25,
      dataVersion: 'v',
      trials: 4000,
    });
  const travelMean = (f: ReturnType<typeof forecastWith>) =>
    f.byCategory.find((c) => c.categoryId === 'travel')!.meanYen;

  it('旅行は毎日の回数モデルに入らず、予定が無ければ多くの月は0円(中央は0)', () => {
    const f = forecastWith([...trip('2025-11-10'), ...trip('2026-04-05')]);
    const travel = f.byCategory.find((c) => c.categoryId === 'travel')!;
    expect(travel.type).toBe('lumpy');
    expect(travel.landing.p50).toBe(0);
    expect(travel.meanYen).toBeGreaterThan(0);
  });

  it('前回の出来事の直後は、次の出来事が起きにくい', () => {
    const longAgo = forecastWith([...trip('2025-11-10'), ...trip('2026-04-05')]);
    const justNow = forecastWith([...trip('2025-11-10'), ...trip('2026-09-26')]);
    expect(travelMean(justNow)).toBeLessThan(travelMean(longAgo));
  });

  it('予定があれば、別の出来事は起きにくい(予定が主役)', () => {
    const trips = [...trip('2025-11-10'), ...trip('2026-04-05')];
    const plain = forecastWith(trips);
    const planned = forecastWith(trips, [
      tx({ occurredOn: '2026-10-20', amountYen: -50000, status: 'scheduled' }),
    ]);
    expect(travelMean(planned)).toBeLessThan(travelMean(plain) * 0.5);
  });
});
