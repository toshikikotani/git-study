import { describe, expect, it } from 'vitest';

import {
  detectInactivity,
  detectPaymentDueTomorrow,
  detectRiskyTransaction,
} from '@/domain/alerts';

describe('detectInactivity(FR-22)', () => {
  it('2日以内なら発火しない', () => {
    expect(detectInactivity('2026-09-07', '2026-09-09')).toBeNull();
  });

  it('ちょうど3日で発火する(境界値)', () => {
    // 2026-09-06 -> 2026-09-09 は3日
    expect(detectInactivity('2026-09-06', '2026-09-09')).not.toBeNull();
  });

  it('3日以上空くと発火する', () => {
    const alert = detectInactivity('2026-09-01', '2026-09-09');
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe('inactivity');
    expect(alert!.dedupKey).toBe('inactivity:2026-09-09');
  });

  it('一度も取り込んでいなければ発火する', () => {
    const alert = detectInactivity(null, '2026-09-09');
    expect(alert).not.toBeNull();
    expect(alert!.body).toMatch(/まだ明細が取り込まれていません/);
  });

  it('日付が変われば dedup_key も変わる(同じ日に二重発火しないだけ)', () => {
    const a = detectInactivity('2026-09-01', '2026-09-09');
    const b = detectInactivity('2026-09-01', '2026-09-10');
    expect(a!.dedupKey).not.toBe(b!.dedupKey);
  });
});

describe('detectPaymentDueTomorrow(FR-23)', () => {
  it('明日が返済日の負債だけ検知する', () => {
    const debts = [
      { id: 'd1', lenderName: 'カードA', paymentDay: 10 },
      { id: 'd2', lenderName: 'カードB', paymentDay: 15 },
    ];
    const alerts = detectPaymentDueTomorrow(debts, '2026-09-09');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.debtId).toBe('d1');
    expect(alerts[0]!.title).toBe('カードAの返済日は明日です');
  });

  it('該当が無ければ空配列', () => {
    const debts = [{ id: 'd1', lenderName: 'カードA', paymentDay: 20 }];
    expect(detectPaymentDueTomorrow(debts, '2026-09-09')).toEqual([]);
  });

  it('29〜31日指定は、その月の末日に丸めて比較する', () => {
    // 2026-09 は30日まで。paymentDay=31 は9/30に丸まる
    const debts = [{ id: 'd1', lenderName: 'カードA', paymentDay: 31 }];
    const alerts = detectPaymentDueTomorrow(debts, '2026-09-29');
    expect(alerts).toHaveLength(1);
  });

  it('月をまたぐ dedup_key になる(月ごとに1回)', () => {
    const debts = [{ id: 'd1', lenderName: 'カードA', paymentDay: 10 }];
    const alerts = detectPaymentDueTomorrow(debts, '2026-09-09');
    expect(alerts[0]!.dedupKey).toBe('payment_due:d1:2026-09');
  });

  it('複数の負債が同じ日に返済日でも、それぞれ検知する', () => {
    const debts = [
      { id: 'd1', lenderName: 'カードA', paymentDay: 27 },
      { id: 'd2', lenderName: 'カードB', paymentDay: 27 },
    ];
    const alerts = detectPaymentDueTomorrow(debts, '2026-09-26');
    expect(alerts.map((a) => a.debtId).sort()).toEqual(['d1', 'd2']);
  });
});

describe('detectRiskyTransaction(FR-21)', () => {
  it('リボ払いを検知する', () => {
    const alert = detectRiskyTransaction({
      id: 't1',
      description: 'カードA利用',
      amountYen: -12800,
      paymentMethod: 'revolving',
    });
    expect(alert.kind).toBe('revolving_detected');
    expect(alert.severity).toBe('critical');
    expect(alert.transactionId).toBe('t1');
    expect(alert.dedupKey).toBe('risky_payment:t1');
    expect(alert.body).toMatch(/12,800円/);
  });

  it('キャッシングを検知する', () => {
    expect(
      detectRiskyTransaction({
        id: 't2',
        description: 'ATM キャッシング',
        amountYen: -50000,
        paymentMethod: 'cashing',
      }).kind,
    ).toBe('cashing_detected');
  });

  it('分割払いを検知する', () => {
    expect(
      detectRiskyTransaction({
        id: 't3',
        description: '家電量販店',
        amountYen: -80000,
        paymentMethod: 'installment',
      }).kind,
    ).toBe('installment_detected');
  });

  it('取引ごとに dedup_key が異なる(同じ取引の再検知だけを防ぐ)', () => {
    const a = detectRiskyTransaction({
      id: 't1',
      description: 'x',
      amountYen: -1000,
      paymentMethod: 'revolving',
    });
    const b = detectRiskyTransaction({
      id: 't2',
      description: 'x',
      amountYen: -1000,
      paymentMethod: 'revolving',
    });
    expect(a.dedupKey).not.toBe(b.dedupKey);
  });
});
