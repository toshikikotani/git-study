import { describe, expect, it } from 'vitest';

import { buildForecast, type BuildForecastInput } from '@/domain/forecast/engine';
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

/** 半年、毎日ちょうど1,000円の外食支出がある合成データ。 */
function steadyTransactions(
  from: string,
  to: string,
  amountYen = -1000,
): ForecastSourceTransaction[] {
  return eachDay(from, to).map((d) => tx({ occurredOn: d, amountYen }));
}

const baseInput: Omit<BuildForecastInput, 'transactions' | 'dataVersion'> = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  today: '2026-10-15',
  trainingFrom: '2026-04-01',
  recordStart: '2026-04-01',
  confirmedFixedKeys: new Set(),
  detectedSubscriptions: [],
  budgetYen: 40_000,
  payday: null,
};

describe('buildForecast(M3)', () => {
  it('同じデータ・同じシードなら、結果が完全に一致する', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const input: BuildForecastInput = { ...baseInput, transactions, dataVersion: 'v1' };
    const a = buildForecast(input);
    const b = buildForecast(input);
    expect(a).toEqual(b);
  });

  it('毎日ちょうど1,000円使う定常データなら、着地予想の中央値は実績+残り日数×1,000円に近い', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const forecast = buildForecast({ ...baseInput, transactions, dataVersion: 'v1' });
    // 実績(10/1〜10/15、15日) 15,000円 + 残り16日(10/15を含む残り日数)×1,000円 見込み
    const expected = 15_000 + forecast.remainingDays * 1000;
    expect(forecast.total.p50).toBeGreaterThan(expected * 0.7);
    expect(forecast.total.p50).toBeLessThan(expected * 1.3);
    expect(forecast.status).toBe('ready');
  });

  it('記録が14日未満なら学習中(learning)になる', () => {
    const transactions = steadyTransactions('2026-10-10', '2026-10-15');
    const forecast = buildForecast({
      ...baseInput,
      today: '2026-10-15',
      trainingFrom: '2026-10-01',
      recordStart: '2026-10-10',
      transactions,
      dataVersion: 'v1',
    });
    expect(forecast.status).toBe('learning');
  });

  it('予定支出を1件足すと、p10・p50・p90がすべてちょうどその金額だけ増える', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const withScheduled: ForecastSourceTransaction[] = [
      ...transactions,
      tx({
        occurredOn: '2026-10-20',
        amountYen: -5000,
        status: 'scheduled',
        genreId: 'hobby',
        genreName: '娯楽',
      }),
    ];
    // 乱数の試行そのものは変えず(同じシード)、確定分の増分だけを見る。
    const a = buildForecast({ ...baseInput, transactions, dataVersion: 'same-seed' });
    const b = buildForecast({
      ...baseInput,
      transactions: withScheduled,
      dataVersion: 'same-seed',
    });
    expect(b.total.p10 - a.total.p10).toBeCloseTo(5000, 6);
    expect(b.total.p50 - a.total.p50).toBeCloseTo(5000, 6);
    expect(b.total.p90 - a.total.p90).toBeCloseTo(5000, 6);
  });

  it('予算を増やすと、予算内に収まる確率は下がらない', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const low = buildForecast({ ...baseInput, transactions, budgetYen: 20_000, dataVersion: 'v1' });
    const high = buildForecast({
      ...baseInput,
      transactions,
      budgetYen: 60_000,
      dataVersion: 'v1',
    });
    expect(high.probWithinBudget!).toBeGreaterThanOrEqual(low.probWithinBudget!);
  });

  it('残り0日(期間の最終日)でも破綻しない', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-31');
    const forecast = buildForecast({
      ...baseInput,
      today: '2026-10-31',
      transactions,
      dataVersion: 'v1',
    });
    expect(Number.isFinite(forecast.total.p50)).toBe(true);
    expect(forecast.remainingDays).toBe(1);
  });

  it('期間が終わった後(today > period.to)でも破綻しない', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-11-05');
    const forecast = buildForecast({
      ...baseInput,
      today: '2026-11-05',
      transactions,
      dataVersion: 'v1',
    });
    expect(Number.isFinite(forecast.total.p50)).toBe(true);
    expect(forecast.remainingDays).toBe(0);
  });

  it('記録0日(明細が無い)でも破綻しない', () => {
    const forecast = buildForecast({ ...baseInput, transactions: [], dataVersion: 'v1' });
    expect(Number.isFinite(forecast.total.p50)).toBe(true);
    expect(forecast.byCategory).toEqual([]);
    expect(forecast.status).toBe('learning');
  });

  it('予算が無ければ probWithinBudget・safeDailyAllowance は null', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const forecast = buildForecast({
      ...baseInput,
      transactions,
      budgetYen: null,
      dataVersion: 'v1',
    });
    expect(forecast.probWithinBudget).toBeNull();
    expect(forecast.safeDailyAllowance).toBeNull();
  });

  it('交通費のような飛び飛びの支出(週2回、他の日は0円)でも予測が破綻しない(直線の延長にならない)', () => {
    const transactions = eachDay('2026-04-01', '2026-10-15')
      .filter((d) => [1, 4].includes(new Date(d).getUTCDay()))
      .map((d) => tx({ occurredOn: d, amountYen: -400, genreId: 'transit', genreName: '交通費' }));
    const forecast = buildForecast({ ...baseInput, transactions, dataVersion: 'v1' });
    // 単純な直線延長(31日 × 400円)のような過大予測にならないこと
    expect(forecast.total.p50).toBeLessThan(15_000);
    expect(forecast.total.p50).toBeGreaterThan(0);
  });

  it('安全に使える1日の額が表示される(予算があるとき)', () => {
    const transactions = steadyTransactions('2026-04-01', '2026-10-15');
    const forecast = buildForecast({ ...baseInput, transactions, dataVersion: 'v1' });
    expect(forecast.safeDailyAllowance).not.toBeNull();
    expect(forecast.safeDailyAllowance!).toBeGreaterThanOrEqual(0);
  });
});
