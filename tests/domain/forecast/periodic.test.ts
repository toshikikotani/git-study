/** 設計書 v3 4.4:期ごと・年ごとの支払い。 */
import { describe, expect, it } from 'vitest';

import type { ForecastSourceTransaction } from '@/domain/forecast/decompose';
import { decomposeSpending } from '@/domain/forecast/decompose';
import { detectPeriodicPayments, projectPeriodic } from '@/domain/forecast/periodic';
import type { VisitSourceTransaction } from '@/domain/forecast/visits';
import { eachDay } from '@/domain/period';

const v = (occurredOn: string, amountYen: number, key = '住民税'): VisitSourceTransaction => ({
  key,
  label: key,
  categoryId: 'tax',
  categoryName: '保険・税金',
  occurredOn,
  amountYen,
});

/** 住民税(普通徴収):6・8・10・1月の4回。 */
const residentTax = ['2024', '2025'].flatMap((y) => [
  v(`${y}-06-28`, 31000),
  v(`${y}-08-28`, 31000),
  v(`${y}-10-28`, 31000),
  v(`${Number(y) + 1}-01-28`, 31000),
]);

describe('detectPeriodicPayments', () => {
  it('住民税の4回を、それぞれ去年の同じ回と組にして1年ごととみる', () => {
    const [p] = detectPeriodicPayments(residentTax, '2026-05-01');
    expect(p!.periodLabel).toBe('1年ごと');
    expect(p!.matchedDates).toHaveLength(8);
    expect(p!.probability).toBe(0.9);
  });

  it('2か月ごとの水道', () => {
    const water = ['01', '03', '05', '07', '09'].map((m) => v(`2026-${m}-10`, 5200, '水道'));
    const [p] = detectPeriodicPayments(water, '2026-10-01');
    expect(p!.periodLabel).toBe('2か月ごと');
    expect(p!.gapDays).toBeGreaterThanOrEqual(59);
  });

  it('毎週の買い物は、金額が似ていても期ごとの支払いとみなさない', () => {
    const weekly = eachDay('2026-01-03', '2026-09-30')
      .filter((_, i) => i % 7 === 0)
      .map((d) => v(d, 5000, 'スーパー'));
    expect(detectPeriodicPayments(weekly, '2026-10-01')).toEqual([]);
  });

  it('金額が大きく違えば組にしない', () => {
    expect(
      detectPeriodicPayments([v('2025-05-20', 36000), v('2026-05-22', 9000)], '2026-06-01'),
    ).toEqual([]);
  });
});

describe('projectPeriodic', () => {
  it('残りの期間に来る回だけを置き、もう払った回は置かない', () => {
    const payments = detectPeriodicPayments(residentTax, '2026-05-01');
    const events = projectPeriodic({
      payments,
      paidDates: () => residentTax.map((t) => t.occurredOn),
      today: '2026-06-10',
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
      scheduled: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.date).toBe('2026-06-28');
    expect(Math.round(Math.exp(events[0]!.logMu))).toBe(31000);
  });
});

describe('decomposeSpending と期ごとの支払い', () => {
  const tx = (occurredOn: string, amountYen: number, merchantName: string) =>
    ({
      occurredOn,
      genreId: 'tax',
      genreName: '保険・税金',
      amountYen,
      status: 'actual',
      kind: 'normal',
      isTransfer: false,
      reviewStatus: 'auto_ok',
      needsInput: false,
      merchantName,
      description: merchantName,
    }) as ForecastSourceTransaction;

  it('期ごとの支払いは変動費・まとまり型から外し、予定(確率つき)として置く', () => {
    const d = decomposeSpending({
      transactions: residentTax.map((t) => tx(t.occurredOn, -t.amountYen, '住民税')),
      period: { from: '2026-06-01', to: '2026-06-30' },
      today: '2026-06-05',
      trainingFrom: '2024-06-01',
      recordStart: '2024-06-01',
      confirmedFixedKeys: new Set(),
      detectedSubscriptions: [],
    });
    expect(d.periodic).toHaveLength(1);
    expect(d.lumpy).toEqual([]);
    expect(d.variable.every((c) => c.days.every((r) => r.count === 0))).toBe(true);
    expect(d.billEvents.map((e) => e.date)).toEqual(['2026-06-28']);
    expect(d.categoryTypes.tax).toBe('fixed');
  });
});
