import { describe, expect, it } from 'vitest';

import { decomposeSpending, type ForecastSourceTransaction } from '@/domain/forecast/decompose';

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

describe('decomposeSpending(M1)', () => {
  it('実績・確定(予定)・変動を分ける', () => {
    const result = decomposeSpending({
      transactions: [
        tx({ occurredOn: '2026-10-01', amountYen: -1000 }),
        tx({ occurredOn: '2026-10-02', amountYen: -2000 }),
        tx({ occurredOn: '2026-10-15', amountYen: -3000, status: 'scheduled' }),
      ],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-02',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(result.actualYen).toBe(3000);
    expect(result.committed.scheduledYen).toBe(3000);
  });

  it('振替・ignored・収入・入力待ちは対象外', () => {
    const result = decomposeSpending({
      transactions: [
        tx({ occurredOn: '2026-10-01', amountYen: -1000, isTransfer: true }),
        tx({ occurredOn: '2026-10-01', amountYen: -1000, reviewStatus: 'ignored' }),
        tx({ occurredOn: '2026-10-01', amountYen: 5000 }),
        tx({ occurredOn: '2026-10-01', amountYen: -1000, needsInput: true }),
        tx({ occurredOn: '2026-10-01', amountYen: -500 }),
      ],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-01',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(result.actualYen).toBe(500);
  });

  it('確認済みの固定費は残り期間の見込み回数ぶん確定分に計上する', () => {
    const result = decomposeSpending({
      transactions: [tx({ occurredOn: '2026-09-05', amountYen: -1000, merchantName: 'サブスクA' })],
      period: { from: '2026-10-01', to: '2026-11-30' },
      today: '2026-10-01',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(['サブスクa:-1000']),
      detectedSubscriptions: [
        {
          key: 'サブスクa:-1000',
          label: 'サブスクA',
          amountYen: 1000,
          occurrenceCount: 2,
          lastOccurredOn: '2026-09-05',
          nextExpectedOn: '2026-10-05',
        },
      ],
    });
    // 10/5, 11/5 の2回が残り期間(10/1〜11/30)に見込まれる
    expect(result.committed.fixedYen).toBe(2000);
    expect(result.committed.fixedItems).toHaveLength(1);
  });

  it('確定済み固定費に紐づく明細は変動費の学習対象から除く(重複計上しない)', () => {
    const result = decomposeSpending({
      transactions: [
        tx({ occurredOn: '2026-09-05', amountYen: -1000, merchantName: 'サブスクA' }),
        tx({ occurredOn: '2026-09-10', amountYen: -500, merchantName: '普通の店' }),
      ],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-01',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(['サブスクa:-1000']),
      detectedSubscriptions: [
        {
          key: 'サブスクa:-1000',
          label: 'サブスクA',
          amountYen: 1000,
          occurrenceCount: 2,
          lastOccurredOn: '2026-09-05',
          nextExpectedOn: '2026-10-05',
        },
      ],
    });
    const totalVariableCount = result.variable.reduce(
      (sum, v) => sum + v.days.reduce((s, d) => s + d.count, 0),
      0,
    );
    expect(totalVariableCount).toBe(1);
  });

  it('外れ値(上位1%)は変動費の学習から除外され、記録される', () => {
    const normal = Array.from({ length: 30 }, (_, i) =>
      tx({ occurredOn: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, amountYen: -1000 }),
    );
    const outlier = tx({ occurredOn: '2026-09-15', amountYen: -100000 });
    const result = decomposeSpending({
      transactions: [...normal, outlier],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-01',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(result.special.excluded.length).toBeGreaterThan(0);
    expect(result.special.excluded[0]!.amountYen).toBe(100000);
  });

  it('学習データが少ない(20件未満)カテゴリでは外れ値判定をしない', () => {
    const result = decomposeSpending({
      transactions: [
        tx({ occurredOn: '2026-09-01', amountYen: -1000 }),
        tx({ occurredOn: '2026-09-02', amountYen: -50000 }),
      ],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-01',
      trainingFrom: '2026-09-01',
      recordStart: '2026-09-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(result.special.excluded).toHaveLength(0);
  });

  it('dataDays は記録開始日と学習窓のうち短い方から数える', () => {
    const result = decomposeSpending({
      transactions: [],
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-10',
      trainingFrom: '2026-04-01',
      recordStart: '2026-10-05',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(result.dataDays).toBe(6); // 10/5〜10/10
  });
});
