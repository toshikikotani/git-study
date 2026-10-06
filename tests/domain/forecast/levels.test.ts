/** 設計書 v3 4.2:ジャンルごとの今月の水準 M_g と、外出のジャンルの日ごとのゆらぎ。 */
import { describe, expect, it } from 'vitest';

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecast } from '@/domain/forecast/engine';
import { outingShockOf } from '@/domain/forecast/model';
import type { VariableTrainingData } from '@/domain/forecast/types';
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

const days = (counts: (i: number) => number, name = '外食'): VariableTrainingData => ({
  categoryId: name,
  categoryName: name,
  days: eachDay('2026-01-01', '2026-06-30').map((date, i) => ({
    date,
    count: counts(i),
    amountYen: counts(i) * 1000,
  })),
});

describe('outingShockOf', () => {
  it('回数のばらつきがポアソンほどなら、ゆらぎを入れない', () => {
    // 毎日1回(ばらつきはポアソンより小さい)。
    expect(outingShockOf([days(() => 1)])).toBeNull();
  });

  it('外出の日にまとめて重なる(0回か4回)なら、ゆらぎを入れる', () => {
    const shock = outingShockOf([days((i) => (i % 4 === 0 ? 4 : 0)), days(() => 0, '交通費')]);
    expect(shock).not.toBeNull();
    expect(shock!.categoryIds).toEqual(['外食', '交通費']);
    expect(shock!.shape).toBeGreaterThanOrEqual(3);
  });

  it('外出でないジャンルには入れない', () => {
    expect(outingShockOf([days((i) => (i % 4 === 0 ? 4 : 0), '食料品')])).toBeNull();
  });
});

describe('ジャンルごとの今月の水準 M_g', () => {
  // 外食と食料品を毎日1回ずつ。今月は外食だけ1日3回に増えている。
  const history = eachDay('2026-06-01', '2026-09-30').flatMap((d) => [
    tx({ occurredOn: d, amountYen: -1000 }),
    tx({ occurredOn: d, amountYen: -1000, genreId: 'grocery', genreName: '食料品' }),
  ]);
  const thisMonth = eachDay('2026-10-01', '2026-10-10').flatMap((d) => [
    tx({ occurredOn: d, amountYen: -1000 }),
    tx({ occurredOn: d, amountYen: -1000 }),
    tx({ occurredOn: d, amountYen: -1000 }),
    tx({ occurredOn: d, amountYen: -1000, genreId: 'grocery', genreName: '食料品' }),
  ]);
  const forecast = (genreLevelK: number) =>
    buildForecast({
      transactions: [...history, ...thisMonth],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-10',
      trainingFrom: '2026-06-01',
      recordStart: '2026-06-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: null,
      payday: null,
      dataVersion: 'v',
      trials: 3000,
      monthLevelK: 8,
      genreLevelK,
    });
  const remainingOf = (f: ReturnType<typeof forecast>, id: string) =>
    f.byCategory.find((c) => c.categoryId === id)!.meanYen;

  it('外食が多い月でも、食料品の見込みは全体の水準ほどには上がらない', () => {
    const shared = forecast(Infinity);
    const own = forecast(3);
    expect(remainingOf(own, 'grocery')).toBeLessThan(remainingOf(shared, 'grocery'));
    expect(remainingOf(own, 'dining')).toBeGreaterThan(remainingOf(shared, 'dining'));
  });
});

describe('今日の残り時間(設計書 v3 4.9)', () => {
  const history = eachDay('2026-06-01', '2026-10-10').map((d) =>
    tx({ occurredOn: d, amountYen: -1000, createdOn: d }),
  );
  const at = (iso: string) =>
    buildForecast({
      transactions: history,
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-10',
      trainingFrom: '2026-06-01',
      recordStart: '2026-06-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
      budgetYen: null,
      payday: null,
      dataVersion: 'v',
      trials: 3000,
      now: new Date(iso),
    }).total.mean;

  it('朝は今日のこれからを多めに、夜は少なめに見込む', () => {
    const morning = at('2026-10-09T23:00:00Z'); // JST 10/10 8:00
    const night = at('2026-10-10T14:00:00Z'); // JST 10/10 23:00
    expect(morning).toBeGreaterThan(night);
  });
});

describe('店ごとの金額(設計書 v3 4.3)', () => {
  it('ランチ1,000円と居酒屋4,000円を混ぜず、2つの山として引く', async () => {
    const { storeMixtureOf } = await import('@/domain/forecast/model');
    const store = (key: string, yen: number, off: number, on: number) => ({
      key,
      offCount: off,
      onCount: on,
      logSum: (off + on) * Math.log(yen),
      logSqSum: (off + on) * Math.log(yen) ** 2,
    });
    const mix = storeMixtureOf(
      [store('lunch', 1000, 2, 40), store('izakaya', 4000, 20, 4), store('once', 2500, 1, 0)],
      Math.log(1800),
      0.5,
    )!;
    expect(mix.mu).toHaveLength(3);
    expect(Math.exp(mix.mu[0]!)).toBeLessThan(1200);
    expect(Math.exp(mix.mu[1]!)).toBeGreaterThan(3200);
    // 休みの日は居酒屋、平日はランチが選ばれやすい。
    expect(mix.shareOff[1]!).toBeGreaterThan(mix.shareOff[0]!);
    expect(mix.shareOn[0]!).toBeGreaterThan(mix.shareOn[1]!);
    // 新しい店の割合(1回だけの店)。
    expect(mix.shareOn[2]!).toBeGreaterThan(0);
    expect(mix.shareOff.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('店が1つしか無ければ、混合を使わない', async () => {
    const { storeMixtureOf } = await import('@/domain/forecast/model');
    expect(
      storeMixtureOf(
        [{ key: 'a', offCount: 10, onCount: 10, logSum: 20 * 7, logSqSum: 20 * 49 }],
        7,
        0.5,
      ),
    ).toBeUndefined();
  });
});
