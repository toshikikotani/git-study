import { describe, expect, it, vi } from 'vitest';

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { eachDay } from '@/domain/period';
import { forecastScopeKey, verifyCautions, verifyForecast } from '@/features/forecast/calibration';

vi.setConfig({ testTimeout: 60_000 });

function expense(
  occurredOn: string,
  genreId: string,
  amountYen: number,
  kind: ForecastSourceTransaction['kind'] = 'normal',
): ForecastSourceTransaction {
  return {
    occurredOn,
    createdOn: occurredOn,
    genreId,
    genreName: genreId,
    amountYen: -amountYen,
    status: 'actual',
    kind,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    needsInput: false,
    merchantName: null,
    description: genreId,
  };
}

describe('予測と同じ範囲の校正', () => {
  it('カテゴリの順番は同じ範囲として扱い、特別費と空のカテゴリ指定は区別する', () => {
    expect(forecastScopeKey({ genreIds: new Set(['a', 'b']) })).toBe(
      forecastScopeKey({ genreIds: new Set(['b', 'a']), excludeSpecial: false }),
    );
    expect(forecastScopeKey({})).toBe(forecastScopeKey(undefined));
    expect(forecastScopeKey({ excludeSpecial: true })).not.toBe(forecastScopeKey(undefined));
    expect(forecastScopeKey({ genreIds: new Set() })).not.toBe(forecastScopeKey(undefined));
  });

  it('対象外のカテゴリと特別費を加えても、対象の明細だけで求めた補正と一致する', () => {
    const selected = eachDay('2026-01-01', '2026-03-31').map((d) => expense(d, 'food', 1000));
    const unrelated = eachDay('2026-01-01', '2026-03-31').map((d, i) =>
      expense(d, 'travel', i % 11 === 0 ? 30000 : 400),
    );
    const special = [
      expense('2026-02-15', 'food', 80000, 'special'),
      expense('2026-03-20', 'food', 120000, 'special'),
    ];
    const common = {
      today: '2026-04-01',
      recordStart: '2026-01-01',
      payday: 25,
    };
    const scoped = verifyForecast({
      ...common,
      cacheKey: 'scope-regression',
      transactions: [...selected, ...unrelated, ...special],
      scope: { genreIds: new Set(['food']), excludeSpecial: true },
    });
    const selectedOnly = verifyForecast({
      ...common,
      cacheKey: 'scope-selected-only',
      transactions: selected,
    });
    expect(scoped).not.toBeNull();
    expect(scoped).toEqual(selectedOnly);

    // 同じ本人・明細の版でも、全体と目標の範囲は別に学習する。
    const all = verifyForecast({
      ...common,
      cacheKey: 'scope-regression',
      transactions: [...selected, ...unrelated, ...special],
    });
    expect(all).not.toEqual(scoped);
  });

  it('注意の検証でも、対象外カテゴリの支出や警告を混ぜない', () => {
    const selected = eachDay('2026-01-01', '2026-03-31').map((d) => expense(d, 'food', 1000));
    const unrelated = eachDay('2026-01-01', '2026-03-31').map((d) => expense(d, 'travel', 10000));
    const common = {
      today: '2026-04-01',
      recordStart: '2026-01-01',
      payday: 25,
      verification: null,
      targets: [
        { categoryId: 'food', targetYen: 20000 },
        { categoryId: 'travel', targetYen: 200000 },
      ],
    };
    const scoped = verifyCautions({
      ...common,
      cacheKey: 'caution-scope-regression',
      transactions: [...selected, ...unrelated],
      scope: { genreIds: new Set(['food']) },
    });
    const selectedOnly = verifyCautions({
      ...common,
      cacheKey: 'caution-selected-only',
      transactions: selected,
    });
    expect(scoped).toEqual(selectedOnly);
    const all = verifyCautions({
      ...common,
      cacheKey: 'caution-scope-regression',
      transactions: [...selected, ...unrelated],
    });
    expect(all).not.toEqual(scoped);
  });
});
