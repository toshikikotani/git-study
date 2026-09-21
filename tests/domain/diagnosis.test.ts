import { describe, expect, it } from 'vitest';

import {
  summarizeDiagnoses,
  summarizeDiagnosesByMonth,
  wasteRatioOf,
  type DiagnosedTransaction,
} from '@/domain/diagnosis';

function tx(
  verdict: 'waste' | 'necessary',
  amountYen: number,
  occurredOn = '2026-08-05',
  overrides: Partial<DiagnosedTransaction> = {},
): DiagnosedTransaction {
  return {
    categoryId: null,
    amountYen,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    occurredOn,
    verdict,
    ...overrides,
  };
}

describe('summarizeDiagnoses', () => {
  it('浪費・必要経費を正の数で合算する', () => {
    const summary = summarizeDiagnoses([tx('waste', -3_000), tx('necessary', -7_000)]);
    expect(summary).toEqual({ wasteYen: 3_000, necessaryYen: 7_000, wasteRatio: 0.3 });
  });

  it('診断が1件も無ければ wasteRatio は null(0%と誤読させない)', () => {
    expect(summarizeDiagnoses([])).toEqual({ wasteYen: 0, necessaryYen: 0, wasteRatio: null });
  });

  it('収入(正の金額)は対象外', () => {
    const summary = summarizeDiagnoses([tx('waste', -1_000), tx('necessary', 250_000)]);
    expect(summary).toEqual({ wasteYen: 1_000, necessaryYen: 0, wasteRatio: 1 });
  });

  it('口座間振替・ignored は対象外', () => {
    const summary = summarizeDiagnoses([
      tx('waste', -5_000, undefined, { isTransfer: true }),
      tx('waste', -5_000, undefined, { reviewStatus: 'ignored' }),
    ]);
    expect(summary).toEqual({ wasteYen: 0, necessaryYen: 0, wasteRatio: null });
  });
});

describe('summarizeDiagnosesByMonth', () => {
  const MONTH_KEYS = ['2026-07', '2026-08', '2026-09'];

  it('月ごとに浪費・必要経費を分けて合算する', () => {
    const rows = summarizeDiagnosesByMonth(
      [tx('waste', -2_000, '2026-08-05'), tx('necessary', -4_000, '2026-08-20')],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08');
    expect(row).toEqual({ monthKey: '2026-08', wasteYen: 2_000, necessaryYen: 4_000 });
  });

  it('診断が無い月も0円で埋める(domain/spending.ts と同じ規約)', () => {
    const rows = summarizeDiagnosesByMonth([], MONTH_KEYS);
    expect(rows).toEqual(
      MONTH_KEYS.map((monthKey) => ({ monthKey, wasteYen: 0, necessaryYen: 0 })),
    );
  });

  it('収入・振替・ignored は数えない', () => {
    const rows = summarizeDiagnosesByMonth(
      [
        tx('waste', 250_000, '2026-08-05'),
        tx('waste', -1_000, '2026-08-06', { isTransfer: true }),
        tx('waste', -1_000, '2026-08-07', { reviewStatus: 'ignored' }),
      ],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08');
    expect(row).toEqual({ monthKey: '2026-08', wasteYen: 0, necessaryYen: 0 });
  });
});

describe('wasteRatioOf', () => {
  it('(浪費)/(浪費+必要経費) を返す', () => {
    expect(wasteRatioOf({ monthKey: '2026-08', wasteYen: 3_000, necessaryYen: 7_000 })).toBe(0.3);
  });

  it('合計が0円なら null(診断していない月と区別する)', () => {
    expect(wasteRatioOf({ monthKey: '2026-08', wasteYen: 0, necessaryYen: 0 })).toBeNull();
  });
});
