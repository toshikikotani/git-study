import { describe, expect, it } from 'vitest';

import {
  buildBudgetPaceAlert,
  buildJobFailureAlert,
  buildMonthlyRecapAlert,
  buildRuleMisfireAlert,
  detectInactivity,
  detectPaymentDueTomorrow,
  detectRiskyTransaction,
  detectWastefulBudget,
  isAheadOfPace,
  isLastDayOfMonth,
  isMisfiringRule,
} from '@/domain/alerts';
import type { BudgetStatus } from '@/domain/budget';

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

function status(overrides: Partial<BudgetStatus>): BudgetStatus {
  return {
    categoryId: 'c1',
    code: 'waste',
    budgetYen: 10000,
    carryOverYen: 0,
    spentYen: 0,
    remainingYen: 10000,
    usageRatio: 0,
    transactionCount: 0,
    ...overrides,
  };
}

describe('detectWastefulBudget(FR-20)', () => {
  it('70%未満なら発火しない', () => {
    expect(
      detectWastefulBudget({ id: 'c1', name: '浪費' }, status({ usageRatio: 0.5 }), '2026-09'),
    ).toBeNull();
  });

  it('ちょうど70%で発火する(境界値)', () => {
    const alert = detectWastefulBudget(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.7, remainingYen: 3000 }),
      '2026-09',
    );
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe('waste_budget_70');
    expect(alert!.title).toBe('浪費が予算の70%に達しました');
    expect(alert!.body).toMatch(/3,000円/);
    expect(alert!.dedupKey).toBe('waste_budget_70:c1:2026-09');
  });

  it('予算未設定(usageRatio が null)なら発火しない', () => {
    expect(
      detectWastefulBudget(
        { id: 'c1', name: '浪費' },
        status({ budgetYen: null, usageRatio: null }),
        '2026-09',
      ),
    ).toBeNull();
  });

  it('月が変わると dedup_key も変わる(月ごとに1回)', () => {
    const a = detectWastefulBudget(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.9 }),
      '2026-09',
    );
    const b = detectWastefulBudget(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.9 }),
      '2026-10',
    );
    expect(a!.dedupKey).not.toBe(b!.dedupKey);
  });
});

describe('buildJobFailureAlert(NFR-06)', () => {
  it('ジョブ名・エラー内容・日付から候補を組み立てる', () => {
    const alert = buildJobFailureAlert('detect-alerts', 'DB接続に失敗しました', '2026-09-12');
    expect(alert.kind).toBe('job_failure');
    expect(alert.severity).toBe('critical');
    expect(alert.title).toBe('detect-alertsが失敗しました');
    expect(alert.body).toBe('DB接続に失敗しました');
    expect(alert.dedupKey).toBe('job_failure:detect-alerts:2026-09-12');
  });

  it('同じ日の別ジョブは dedup_key が異なる', () => {
    const a = buildJobFailureAlert('detect-alerts', 'x', '2026-09-12');
    const b = buildJobFailureAlert('morning-brief', 'x', '2026-09-12');
    expect(a.dedupKey).not.toBe(b.dedupKey);
  });
});

describe('isMisfiringRule(P5-2)', () => {
  it('母数が最低件数(既定3件)に満たなければ判定しない', () => {
    expect(isMisfiringRule({ hitCount: 2, correctedCount: 2 })).toBe(false);
  });

  it('修正率が閾値(既定50%)以上なら誤爆と判定する', () => {
    expect(isMisfiringRule({ hitCount: 4, correctedCount: 2 })).toBe(true);
  });

  it('修正率が閾値未満なら誤爆と判定しない', () => {
    expect(isMisfiringRule({ hitCount: 10, correctedCount: 2 })).toBe(false);
  });

  it('閾値・最低件数はオプションで上書きできる', () => {
    expect(isMisfiringRule({ hitCount: 5, correctedCount: 1 }, { minHits: 5 })).toBe(false);
    expect(
      isMisfiringRule({ hitCount: 5, correctedCount: 1 }, { correctionRateThreshold: 0.2 }),
    ).toBe(true);
  });
});

describe('buildRuleMisfireAlert(P5-2)', () => {
  it('ルール名・件数から候補を組み立てる', () => {
    const alert = buildRuleMisfireAlert('r1', 'ローソンを浪費に分類', 3, 5);
    expect(alert.kind).toBe('other');
    expect(alert.severity).toBe('warn');
    expect(alert.title).toBe('ルール「ローソンを浪費に分類」を無効化しました');
    expect(alert.body).toMatch(/5件中3件/);
    expect(alert.dedupKey).toBe('rule_misfire:r1');
  });

  it('ルールごとに dedup_key が異なる', () => {
    const a = buildRuleMisfireAlert('r1', 'x', 3, 5);
    const b = buildRuleMisfireAlert('r2', 'x', 3, 5);
    expect(a.dedupKey).not.toBe(b.dedupKey);
  });
});

describe('isAheadOfPace(P5-3)', () => {
  it('経過日数に対して消化率が閾値(既定1.5倍)以上ならペースが速いと判定する', () => {
    // 30日中9日経過(30%)で使用率50% → 50/30 ≈ 1.67倍
    expect(isAheadOfPace(status({ usageRatio: 0.5 }), 9, 30)).toBe(true);
  });

  it('ペースが遅ければ判定しない', () => {
    // 30日中20日経過(67%)で使用率30% → 30/67 ≈ 0.45倍
    expect(isAheadOfPace(status({ usageRatio: 0.3 }), 20, 30)).toBe(false);
  });

  it('既に70%に達していればここでは発火しない(FR-20側の責務)', () => {
    expect(isAheadOfPace(status({ usageRatio: 0.9 }), 5, 30)).toBe(false);
  });

  it('月初の数日(既定3日未満)は誤検知を避けるため判定しない', () => {
    expect(isAheadOfPace(status({ usageRatio: 0.3 }), 1, 30)).toBe(false);
  });

  it('usageRatio が null(予算未設定)なら判定しない', () => {
    expect(isAheadOfPace(status({ budgetYen: null, usageRatio: null }), 9, 30)).toBe(false);
  });

  it('閾値・最低経過日数はオプションで上書きできる', () => {
    expect(isAheadOfPace(status({ usageRatio: 0.2 }), 9, 30, { paceMultiplier: 0.5 })).toBe(true);
    expect(isAheadOfPace(status({ usageRatio: 0.5 }), 2, 30, { minElapsedDays: 1 })).toBe(true);
  });
});

describe('buildBudgetPaceAlert(P5-3)', () => {
  it('カテゴリ名・残額から候補を組み立てる', () => {
    const alert = buildBudgetPaceAlert(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.5, remainingYen: 5000 }),
      '2026-09',
    );
    expect(alert.kind).toBe('other');
    expect(alert.severity).toBe('info');
    expect(alert.title).toBe('浪費のペースが速めです');
    expect(alert.body).toMatch(/5,000円/);
    expect(alert.dedupKey).toBe('budget_pace:c1:2026-09');
  });

  it('月が変わると dedup_key も変わる', () => {
    const a = buildBudgetPaceAlert(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.5 }),
      '2026-09',
    );
    const b = buildBudgetPaceAlert(
      { id: 'c1', name: '浪費' },
      status({ usageRatio: 0.5 }),
      '2026-10',
    );
    expect(a.dedupKey).not.toBe(b.dedupKey);
  });
});

describe('isLastDayOfMonth(P6-1)', () => {
  it('翌日が翌月なら月末とみなす', () => {
    expect(isLastDayOfMonth('2026-09-30', '2026-10-01')).toBe(true);
  });

  it('30日までの月でも正しく判定する(31日固定にしない)', () => {
    expect(isLastDayOfMonth('2026-04-30', '2026-05-01')).toBe(true);
  });

  it('翌日も同じ月なら月末ではない', () => {
    expect(isLastDayOfMonth('2026-09-29', '2026-09-30')).toBe(false);
  });
});

describe('buildMonthlyRecapAlert(P6-1)', () => {
  it('返済・副業収入・浪費カテゴリの状況を1件のアラートにまとめる', () => {
    const alert = buildMonthlyRecapAlert({
      monthKey: '2026-09',
      totalPaidYen: 50_000,
      totalSideIncomeYen: 30_000,
      wasteCategories: [{ name: '浪費', status: status({ spentYen: 15_000, usageRatio: 0.75 }) }],
    });
    expect(alert.kind).toBe('other');
    expect(alert.title).toBe('2026年9月の振り返り');
    expect(alert.body).toMatch(/今月の返済: 50,000円/);
    expect(alert.body).toMatch(/副業収入: 30,000円/);
    expect(alert.body).toMatch(/浪費: 15,000円\(予算の75%\)/);
    expect(alert.dedupKey).toBe('monthly_recap:2026-09');
  });

  it('浪費カテゴリが無くても組み立てられる', () => {
    const alert = buildMonthlyRecapAlert({
      monthKey: '2026-09',
      totalPaidYen: 0,
      totalSideIncomeYen: 0,
      wasteCategories: [],
    });
    expect(alert.body).toBe('今月の返済: 0円\n副業収入: 0円');
  });

  it('予算が無い浪費カテゴリは「予算なし」と表示する', () => {
    const alert = buildMonthlyRecapAlert({
      monthKey: '2026-09',
      totalPaidYen: 0,
      totalSideIncomeYen: 0,
      wasteCategories: [
        { name: '浪費', status: status({ budgetYen: null, usageRatio: null, spentYen: 3_000 }) },
      ],
    });
    expect(alert.body).toMatch(/浪費: 3,000円\(予算なし\)/);
  });

  it('月が変わると dedup_key も変わる', () => {
    const summary = { totalPaidYen: 0, totalSideIncomeYen: 0, wasteCategories: [] };
    const a = buildMonthlyRecapAlert({ ...summary, monthKey: '2026-09' });
    const b = buildMonthlyRecapAlert({ ...summary, monthKey: '2026-10' });
    expect(a.dedupKey).not.toBe(b.dedupKey);
  });
});
