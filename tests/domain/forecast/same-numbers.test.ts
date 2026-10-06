/**
 * 設計書 v3 の P0 の条件:「全画面で、同じ範囲の同じ数字」。
 * 見出し(着地)・グラフの右端・ジャンル別の行が、同じ範囲・同じ試行から出ていること、
 * ジャンルの着地が使った額(家計簿の数え方)を下回らないことを確かめる。
 */
import { describe, expect, it } from 'vitest';

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { buildForecast } from '@/domain/forecast/engine';
import { landingRowsFrom } from '@/domain/forecast/landing-rows';
import { remainingOfCategory, remainingOfTotal } from '@/domain/forecast/remaining';
import { eachDay } from '@/domain/period';
import { excludedSpend } from '@/features/forecast/load';

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

const period = { from: '2026-10-01', to: '2026-10-31' };
const today = '2026-10-06';
const transactions: ForecastSourceTransaction[] = [
  ...eachDay('2026-07-01', today).map((d) => tx({ occurredOn: d, amountYen: -1200 })),
  ...eachDay('2026-07-01', today)
    .filter((_, i) => i % 4 === 0)
    .map((d) => tx({ occurredOn: d, amountYen: -3000, genreId: 'hobby', genreName: '娯楽' })),
  // 目標の範囲から外れる特別費(娯楽)と、確定した保険(予測を止めたジャンル)。
  tx({
    occurredOn: '2026-10-03',
    amountYen: -3000,
    genreId: 'hobby',
    genreName: '娯楽',
    kind: 'special',
  }),
  tx({ occurredOn: '2026-10-02', amountYen: -32000, genreId: 'tax', genreName: '保険' }),
];
const scope = { genreIds: new Set(['dining', 'hobby', 'tax']), excludeSpecial: true };
const base = {
  transactions,
  period,
  today,
  trainingFrom: '2026-07-01',
  recordStart: '2026-07-01',
  confirmedFixedKeys: new Set<string>(),
  detectedSubscriptions: [],
  payday: 25,
  dataVersion: 'v',
  trials: 2000,
};

describe('同じ範囲の同じ数字(P0)', () => {
  const forecast = buildForecast({
    ...base,
    budgetYen: 120000,
    scope,
    noForecastGenreIds: new Set(['tax']),
    categoryTargets: [
      { categoryId: 'dining', categoryName: '外食', targetYen: 40000 },
      { categoryId: 'hobby', categoryName: '娯楽', targetYen: 30000 },
      { categoryId: 'tax', categoryName: '保険', targetYen: 32000 },
    ],
  });

  it('見出しの着地とグラフの右端が同じ', () => {
    const rem = remainingOfTotal(forecast);
    const known = forecast.actualYen;
    const last = rem.path!.at(-1)!;
    expect(known + last.medianYen).toBe(forecast.total.p50);
    expect(known + last.lowYen).toBe(forecast.total.p10);
    expect(known + last.highYen).toBe(forecast.total.p90);
  });

  it('ジャンルの着地は、家計簿の使った額を下回らない(外した額は行で出す)', () => {
    const rows = landingRowsFrom({
      forecast,
      excludedByCategory: excludedSpend(transactions, period, scope),
      closedGenreIds: new Set(['tax']),
    });
    const spentByGenre = new Map<string, number>();
    for (const t of transactions) {
      if (t.occurredOn < period.from || t.occurredOn > today || t.genreId === null) continue;
      spentByGenre.set(t.genreId, (spentByGenre.get(t.genreId) ?? 0) - t.amountYen);
    }
    for (const row of rows) {
      expect(row.p10).toBeGreaterThanOrEqual(spentByGenre.get(row.genreId) ?? 0);
    }
    const hobby = rows.find((r) => r.genreId === 'hobby')!;
    expect(hobby.excludedYen).toBe(3000);
    const tax = rows.find((r) => r.genreId === 'tax')!;
    expect(tax.status).toBe('closed');
    expect(tax.p50).toBe(32000);
  });

  it('カテゴリ画面(そのジャンルだけの予測)は、そのジャンルの線をそのまま使う', () => {
    const only = buildForecast({
      ...base,
      budgetYen: null,
      scope: { genreIds: new Set(['dining']) },
    });
    const rem = remainingOfCategory(only, 'dining')!;
    expect(only.actualYen + rem.path!.at(-1)!.medianYen).toBe(only.total.p50);
  });
});
