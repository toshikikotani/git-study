import { describe, expect, it } from 'vitest';

import { billingPeriodFor, reconcileTotals } from '@/domain/statement-reconciliation';

describe('billingPeriodFor(FR-18, M6-4)', () => {
  it('メールに期間の記載があればそれを使う', () => {
    expect(
      billingPeriodFor(
        { periodStartOn: '2026-08-11', periodEndOn: '2026-09-10' },
        20,
        '2026-09-15',
      ),
    ).toEqual({ startOn: '2026-08-11', endOn: '2026-09-10' });
  });

  it('期間が無くても締め日があれば直近のサイクルを計算する', () => {
    expect(billingPeriodFor({ periodStartOn: null, periodEndOn: null }, 10, '2026-09-15')).toEqual({
      startOn: '2026-08-11',
      endOn: '2026-09-10',
    });
  });

  it('期間も締め日も無ければ null', () => {
    expect(
      billingPeriodFor({ periodStartOn: null, periodEndOn: null }, null, '2026-09-15'),
    ).toBeNull();
  });
});

describe('reconcileTotals(FR-18, M6-4)', () => {
  it('一致すれば差額0・discrepancyなし', () => {
    expect(reconcileTotals(10000, 10000)).toEqual({ differenceYen: 0, hasDiscrepancy: false });
  });

  it('お知らせの方が多ければ取り込み漏れの疑い(正の差額)', () => {
    expect(reconcileTotals(10000, 7000)).toEqual({ differenceYen: 3000, hasDiscrepancy: true });
  });

  it('取り込み済みの方が多ければ負の差額', () => {
    expect(reconcileTotals(7000, 10000)).toEqual({ differenceYen: -3000, hasDiscrepancy: true });
  });
});
