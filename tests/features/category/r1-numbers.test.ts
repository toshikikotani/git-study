import { describe, expect, it } from 'vitest';

import { monthRange } from '../../../src/domain/ledger';
import { buildCategoryLines, type CategoryTx } from '../../../src/features/category/model';
import { categoryAllowanceYen, goalOverlaps } from '../../../src/features/category/pace';
import { buildSeries, niceCeil } from '../../../src/features/category/series';
import { ledgerTx } from '../../helpers/ledger';

const TODAY = '2026-09-29';
const SEP = monthRange('2026-09');
const WINDOW = { from: '2026-03-01', to: '2026-09-30' };
const tx = (o: Parameters<typeof ledgerTx>[0]): CategoryTx => ({ ...ledgerTx(o), items: [] });
const lines = (data: CategoryTx[]) => buildCategoryLines(data, 'transport', WINDOW, TODAY);
const build = (data: CategoryTx[], allowance: number | null = null) =>
  buildSeries({
    lines: lines(data),
    unit: 'day',
    monthStart: '2026-09-01',
    monthEnd: SEP.to,
    today: TODAY,
    dailyAllowanceYen: allowance,
  });
const t = (id: string, date: string, yen: number, extra: Partial<CategoryTx> = {}) =>
  tx({ id, occurredOn: date, genreId: 'transport', amountYen: -yen, ...extra });

describe('R1 カテゴリの1日の目安(予算 − 予定 − 昨日までの実績)÷ 残り日数', () => {
  const goal = { from: '2026-09-29', to: '2026-10-06' }; // 8日間

  it('例:交通・車両 5,300円 ÷ 8日 ≒ 663円(全カテゴリ合計の2,300円ではない)', () => {
    const v = categoryAllowanceYen({
      budgetYen: 5300,
      scheduledYen: 0,
      lines: lines([]),
      goalRange: goal,
      today: '2026-09-29',
    });
    expect(v).toBe(663);
    expect(v).not.toBe(2300);
  });

  it('予定の支出と、昨日までの実績を引く。今日の実績は引かない(今日ぶんはこれから使える額)', () => {
    const data = [t('a', '2026-09-30', 300), t('b', '2026-10-01', 200, { status: 'scheduled' })];
    const v = categoryAllowanceYen({
      budgetYen: 5300,
      scheduledYen: 200,
      lines: buildCategoryLines(
        data,
        'transport',
        { from: '2026-09-01', to: '2026-10-31' },
        '2026-09-30',
      ),
      goalRange: goal,
      today: '2026-09-30',
    });
    // 昨日(9/29)までの実績 0、9/30の300円は「今日」なので引かない。残り7日: (5300-200)/7
    expect(v).toBe(Math.round(5100 / 7));
    const v2 = categoryAllowanceYen({
      budgetYen: 5300,
      scheduledYen: 0,
      lines: buildCategoryLines(
        [t('c', '2026-09-29', 900)],
        'transport',
        { from: '2026-09-01', to: '2026-10-31' },
        '2026-09-30',
      ),
      goalRange: goal,
      today: '2026-09-30',
    });
    expect(v2).toBe(Math.round((5300 - 900) / 7));
  });

  it('使い切ったら0円(負にしない)、目標が終わっている・予算なしは null、目標の前は期間全体で割る', () => {
    expect(
      categoryAllowanceYen({
        budgetYen: 100,
        scheduledYen: 500,
        lines: [],
        goalRange: goal,
        today: '2026-09-29',
      }),
    ).toBe(0);
    expect(
      categoryAllowanceYen({
        budgetYen: 5300,
        scheduledYen: 0,
        lines: [],
        goalRange: goal,
        today: '2026-10-07',
      }),
    ).toBeNull();
    expect(
      categoryAllowanceYen({
        budgetYen: null,
        scheduledYen: 0,
        lines: [],
        goalRange: goal,
        today: '2026-09-29',
      }),
    ).toBeNull();
    expect(
      categoryAllowanceYen({
        budgetYen: 8000,
        scheduledYen: 0,
        lines: [],
        goalRange: goal,
        today: '2026-09-20',
      }),
    ).toBe(1000);
  });

  it('グラフに出す目安は、カテゴリの目安そのもの(週は×7)', () => {
    expect(build([t('a', '2026-09-21', 500)], 663).allowanceYen).toBe(663);
  });

  it('表示中の期間が目標期間と重なるときだけ表示する', () => {
    expect(goalOverlaps(goal, '2026-09-01', '2026-09-30')).toBe(true);
    expect(goalOverlaps(goal, '2026-10-01', '2026-10-31')).toBe(true);
    expect(goalOverlaps(goal, '2026-08-01', '2026-08-31')).toBe(false);
  });
});

describe('R1 1日平均は「記録開始日以降の日数」で割る', () => {
  it('9/21から記録がある月:合計 ÷ (9/21〜9/29 の9日)で、30日では割らない', () => {
    const data = [t('a', '2026-09-21', 1800), t('b', '2026-09-27', 900)];
    const s = build(data);
    expect(s.recordStart).toBe('2026-09-21');
    expect(s.averageFrom).toBe('2026-09-21');
    expect(s.averageYen).toBe(300); // 2700 ÷ 9
    expect(s.averageYen).not.toBe(90); // 2700 ÷ 30
  });

  it('横軸は記録開始日から始まり、それより前の日は描かない', () => {
    const s = build([t('a', '2026-09-21', 1800)]);
    expect(s.buckets[0]!.from).toBe('2026-09-21');
    expect(s.buckets).toHaveLength(10); // 9/21〜9/30
    expect(s.buckets.every((b) => b.from >= '2026-09-21')).toBe(true);
  });

  it('前の月から記録があれば、月の初日から数える', () => {
    const s = build([t('p', '2026-08-10', 500), t('a', '2026-09-21', 2900)]);
    expect(s.recordStart).toBe('2026-09-01');
    expect(s.averageYen).toBe(Math.round(2900 / 29));
  });

  it('記録が無い月は平均を出さない…ことはなく0円(月初から数える)。未来の月は出さない', () => {
    expect(build([]).averageYen).toBe(0);
    expect(build([]).averageLineYen).toBeNull();
    const future = buildSeries({
      lines: [],
      unit: 'day',
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
      today: TODAY,
      dailyAllowanceYen: null,
    });
    expect(future.averageYen).toBeNull();
  });
});

describe('R1 縦軸の上限:すべての値を含み、切りのよい数に丸める', () => {
  it('niceCeil は 1・2・2.5・5 ×10のべき乗', () => {
    expect(niceCeil(2830)).toBe(5000);
    expect(niceCeil(1000)).toBe(1000);
    expect(niceCeil(1001)).toBe(2000);
    expect(niceCeil(2001)).toBe(2500);
    expect(niceCeil(2500)).toBe(2500);
    expect(niceCeil(5001)).toBe(10000);
    expect(niceCeil(0)).toBe(1000);
    expect(niceCeil(26000)).toBe(50000);
  });

  it('棒・予定・前期間・平均・目安のどれよりも上限が大きい(はみ出さない)', () => {
    const data = [
      t('a', '2026-09-29', 2830), // 9/29 の棒(不具合:上端を突き抜けていた)
      t('p', '2026-08-29', 4100), // 前期間
      t('s', '2026-09-30', 900, { status: 'scheduled' }),
    ];
    const s = build(data, 3700);
    const values = [
      ...s.buckets.map((b) => Math.max(b.actualYen, 0) + b.scheduledYen),
      ...s.buckets.map((b) => b.previousYen ?? 0),
      s.averageLineYen ?? 0,
      s.allowanceYen ?? 0,
    ];
    for (const v of values) expect(v).toBeLessThanOrEqual(s.maxYen);
    expect(s.maxYen).toBe(5000);
    expect(s.ticks).toEqual([2500, 5000]);
  });

  it('週の目安(×7)が大きいときも収まる', () => {
    const s = buildSeries({
      lines: lines([t('a', '2026-09-05', 500)]),
      unit: 'week',
      monthStart: '2026-09-01',
      monthEnd: SEP.to,
      today: TODAY,
      dailyAllowanceYen: 2300,
    });
    expect(s.allowanceYen).toBe(16100);
    expect(s.maxYen).toBeGreaterThanOrEqual(16100);
    expect(s.maxYen).toBe(20000);
  });
});

describe('R1 前期間のデータが無いとき', () => {
  it('hasPrevious=false(「前期間と比べる」を無効にする)。ある月は true', () => {
    expect(build([t('a', '2026-09-05', 500)]).hasPrevious).toBe(false);
    expect(build([t('a', '2026-09-05', 500), t('p', '2026-08-05', 500)]).hasPrevious).toBe(true);
  });
});
