import { describe, expect, it } from 'vitest';

import {
  annualizedPaceYen,
  compareToPreviousMonthPace,
  summarizeNoSpendDays,
  summarizeSmallSpends,
  type AccumulationTransaction,
} from '@/domain/accumulation';

function tx(
  overrides: Partial<AccumulationTransaction> & { occurredOn: string; amountYen: number },
): AccumulationTransaction {
  return {
    categoryId: null,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    label: 'コンビニ',
    ...overrides,
  };
}

describe('summarizeSmallSpends', () => {
  it('しきい値未満の支出を店ごとに合計し、多い順に返す', () => {
    const result = summarizeSmallSpends([
      tx({ occurredOn: '2026-09-01', amountYen: -500, label: 'コンビニ' }),
      tx({ occurredOn: '2026-09-02', amountYen: -300, label: 'コンビニ' }),
      tx({ occurredOn: '2026-09-03', amountYen: -600, label: 'カフェ' }),
    ]);

    expect(result).toEqual([
      { label: 'コンビニ', count: 2, totalYen: 800, averageYen: 400 },
      { label: 'カフェ', count: 1, totalYen: 600, averageYen: 600 },
    ]);
  });

  it('しきい値以上の支出は小口に数えない', () => {
    const result = summarizeSmallSpends([
      tx({ occurredOn: '2026-09-01', amountYen: -1_000 }),
      tx({ occurredOn: '2026-09-02', amountYen: -5_000 }),
    ]);
    expect(result).toEqual([]);
  });

  it('しきい値は上書きできる', () => {
    const result = summarizeSmallSpends([tx({ occurredOn: '2026-09-01', amountYen: -1_500 })], {
      thresholdYen: 2_000,
    });
    expect(result).toHaveLength(1);
  });

  it('店名の表記ゆれ(空白・大文字小文字)は同じ店としてまとめる', () => {
    const result = summarizeSmallSpends([
      tx({ occurredOn: '2026-09-01', amountYen: -500, label: 'Cafe Latte' }),
      tx({ occurredOn: '2026-09-02', amountYen: -500, label: 'cafelatte' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ count: 2, totalYen: 1_000 });
  });

  it('振替・ignored・収入は対象外', () => {
    const result = summarizeSmallSpends([
      tx({ occurredOn: '2026-09-01', amountYen: -500, isTransfer: true }),
      tx({ occurredOn: '2026-09-02', amountYen: -500, reviewStatus: 'ignored' }),
      tx({ occurredOn: '2026-09-03', amountYen: 500 }),
    ]);
    expect(result).toEqual([]);
  });

  it('limit で件数を絞れる', () => {
    const result = summarizeSmallSpends(
      [
        tx({ occurredOn: '2026-09-01', amountYen: -900, label: 'A' }),
        tx({ occurredOn: '2026-09-02', amountYen: -800, label: 'B' }),
        tx({ occurredOn: '2026-09-03', amountYen: -700, label: 'C' }),
      ],
      { limit: 2 },
    );
    expect(result.map((g) => g.label)).toEqual(['A', 'B']);
  });
});

describe('summarizeNoSpendDays', () => {
  it('支出があった日だけを分母に平均を出す', () => {
    const result = summarizeNoSpendDays(
      [
        tx({ occurredOn: '2026-09-01', amountYen: -1_000 }),
        tx({ occurredOn: '2026-09-02', amountYen: -3_000 }),
      ],
      { from: '2026-09-01', to: '2026-09-04' },
    );

    expect(result).toEqual({
      elapsedDays: 4,
      spentDays: 2,
      noSpendDays: 2,
      averageSpendPerSpentDayYen: 2_000,
      preservedYen: 4_000,
    });
  });

  it('同じ日の複数の支出は1日としてまとめる', () => {
    const result = summarizeNoSpendDays(
      [
        tx({ occurredOn: '2026-09-01', amountYen: -400 }),
        tx({ occurredOn: '2026-09-01', amountYen: -600 }),
      ],
      { from: '2026-09-01', to: '2026-09-02' },
    );
    expect(result.spentDays).toBe(1);
    expect(result.averageSpendPerSpentDayYen).toBe(1_000);
  });

  it('期間外の明細は数えない', () => {
    const result = summarizeNoSpendDays([tx({ occurredOn: '2026-08-31', amountYen: -1_000 })], {
      from: '2026-09-01',
      to: '2026-09-02',
    });
    expect(result.spentDays).toBe(0);
    expect(result.noSpendDays).toBe(2);
  });

  it('支出が1件も無ければ平均も温存額も0', () => {
    const result = summarizeNoSpendDays([], { from: '2026-09-01', to: '2026-09-03' });
    expect(result).toMatchObject({
      noSpendDays: 3,
      averageSpendPerSpentDayYen: 0,
      preservedYen: 0,
    });
  });
});

describe('compareToPreviousMonthPace', () => {
  it('今月の月初〜今日と、先月の月初〜同じ日を比べる', () => {
    const result = compareToPreviousMonthPace(
      [
        tx({ occurredOn: '2026-09-01', amountYen: -1_000 }),
        tx({ occurredOn: '2026-09-05', amountYen: -2_000 }),
        // 先月の同じ日まで
        tx({ occurredOn: '2026-08-03', amountYen: -5_000 }),
        // 先月の同じ日より後(比較に含めない)
        tx({ occurredOn: '2026-08-20', amountYen: -9_000 }),
      ],
      '2026-09-05',
    );

    expect(result).toEqual({
      dayOfMonth: 5,
      thisMonthToDateYen: 3_000,
      lastMonthSameDayYen: 5_000,
      differenceYen: -2_000,
    });
  });

  it('今月の方が多ければ差は正になる', () => {
    const result = compareToPreviousMonthPace(
      [
        tx({ occurredOn: '2026-09-02', amountYen: -8_000 }),
        tx({ occurredOn: '2026-08-02', amountYen: -3_000 }),
      ],
      '2026-09-03',
    );
    expect(result.differenceYen).toBe(5_000);
  });

  it('先月に同じ日が無い場合は月末に丸めて比べる(3/31 に対する2月)', () => {
    const result = compareToPreviousMonthPace(
      [tx({ occurredOn: '2026-02-28', amountYen: -1_000 })],
      '2026-03-31',
    );
    expect(result.lastMonthSameDayYen).toBe(1_000);
  });
});

describe('annualizedPaceYen', () => {
  it('1日あたりに均してから365倍する', () => {
    expect(annualizedPaceYen(3_000, 10)).toBe(109_500);
  });

  it('月初の数日でも過小評価しない(合計×12 とは異なる)', () => {
    // 3日で6,000円 → 1日2,000円 → 年730,000円。6,000×12=72,000 とは桁が違う
    expect(annualizedPaceYen(6_000, 3)).toBe(730_000);
  });

  it('経過日数が0以下なら0を返す', () => {
    expect(annualizedPaceYen(5_000, 0)).toBe(0);
  });
});
