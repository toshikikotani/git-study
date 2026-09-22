import { describe, expect, it } from 'vitest';

import type { AccumulationTransaction } from '@/domain/accumulation';
import {
  averageDailySpendYen,
  projectedMonthTotalYen,
  rankMerchantsBySpend,
  savingsRateOf,
  summarizeMonthlyIncomeExpense,
  summarizeMonthlySpendByCategory,
  type SpendingTransaction,
} from '@/domain/spending';
import { formatYen } from '@/domain/money';

const CATEGORIES = [
  { id: 'cat-waste', name: '浪費' },
  { id: 'cat-food', name: '食費' },
];
const MONTH_KEYS = ['2026-07', '2026-08', '2026-09'];

function spend(
  categoryId: string | null,
  amountYen: number,
  occurredOn: string,
): SpendingTransaction {
  return { categoryId, amountYen, isTransfer: false, reviewStatus: 'auto_ok', occurredOn };
}

describe('summarizeMonthlySpendByCategory', () => {
  it('月ごとの支出を正の数で集計する', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [spend('cat-waste', -3_000, '2026-08-05')],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08' && r.categoryId === 'cat-waste');
    expect(row?.spentYen).toBe(3_000);
  });

  it('全月・全カテゴリの組み合わせを0円で埋める(データが無い月も区別できるようにする)', () => {
    const rows = summarizeMonthlySpendByCategory(CATEGORIES, [], MONTH_KEYS);
    expect(rows).toHaveLength(CATEGORIES.length * MONTH_KEYS.length);
    expect(rows.every((r) => r.spentYen === 0)).toBe(true);
  });

  it('口座間振替は数えない', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [
        {
          categoryId: 'cat-waste',
          amountYen: -5_000,
          isTransfer: true,
          reviewStatus: 'auto_ok',
          occurredOn: '2026-08-05',
        },
      ],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08' && r.categoryId === 'cat-waste');
    expect(row?.spentYen).toBe(0);
  });

  it('ignored の明細は数えない', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [
        {
          categoryId: 'cat-waste',
          amountYen: -5_000,
          isTransfer: false,
          reviewStatus: 'ignored',
          occurredOn: '2026-08-05',
        },
      ],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08' && r.categoryId === 'cat-waste');
    expect(row?.spentYen).toBe(0);
  });

  it('収入(正の金額)は支出に混ぜない', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [spend('cat-food', 10_000, '2026-08-05')],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08' && r.categoryId === 'cat-food');
    expect(row?.spentYen).toBe(0);
  });

  it('未分類(categoryId: null)は集計対象に含めない', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [spend(null, -1_000, '2026-08-05')],
      MONTH_KEYS,
    );
    expect(rows.every((r) => r.spentYen === 0)).toBe(true);
  });

  it('同月・同カテゴリの複数取引を合算する', () => {
    const rows = summarizeMonthlySpendByCategory(
      CATEGORIES,
      [spend('cat-waste', -1_000, '2026-08-01'), spend('cat-waste', -2_500, '2026-08-20')],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08' && r.categoryId === 'cat-waste');
    expect(row?.spentYen).toBe(3_500);
  });
});

describe('summarizeMonthlyIncomeExpense', () => {
  it('月ごとの収入・支出を分けて合算する', () => {
    const rows = summarizeMonthlyIncomeExpense(
      [spend('cat-food', -3_000, '2026-08-05'), spend(null, 250_000, '2026-08-25')],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08');
    expect(row).toEqual({ monthKey: '2026-08', incomeYen: 250_000, expenseYen: 3_000 });
  });

  it('未分類(categoryId: null)の支出も含める(カテゴリ別集計と違い、収支全体には漏らせない)', () => {
    const rows = summarizeMonthlyIncomeExpense([spend(null, -1_000, '2026-08-05')], MONTH_KEYS);
    const row = rows.find((r) => r.monthKey === '2026-08');
    expect(row?.expenseYen).toBe(1_000);
  });

  it('口座間振替・ignored は数えない', () => {
    const rows = summarizeMonthlyIncomeExpense(
      [
        {
          categoryId: null,
          amountYen: -5_000,
          isTransfer: true,
          reviewStatus: 'auto_ok',
          occurredOn: '2026-08-05',
        },
        {
          categoryId: null,
          amountYen: -5_000,
          isTransfer: false,
          reviewStatus: 'ignored',
          occurredOn: '2026-08-05',
        },
      ],
      MONTH_KEYS,
    );
    const row = rows.find((r) => r.monthKey === '2026-08');
    expect(row).toEqual({ monthKey: '2026-08', incomeYen: 0, expenseYen: 0 });
  });

  it('取引が無い月も0円で埋める', () => {
    const rows = summarizeMonthlyIncomeExpense([], MONTH_KEYS);
    expect(rows).toEqual(MONTH_KEYS.map((monthKey) => ({ monthKey, incomeYen: 0, expenseYen: 0 })));
  });
});

describe('savingsRateOf', () => {
  it('(収入-支出)/収入を返す', () => {
    expect(savingsRateOf({ monthKey: '2026-08', incomeYen: 200_000, expenseYen: 150_000 })).toBe(
      0.25,
    );
  });

  it('収入が0円の月は null(0%と誤読させない)', () => {
    expect(savingsRateOf({ monthKey: '2026-08', incomeYen: 0, expenseYen: 5_000 })).toBeNull();
  });

  it('支出が収入を上回れば負の値になる', () => {
    const rate = savingsRateOf({ monthKey: '2026-08', incomeYen: 100_000, expenseYen: 120_000 });
    expect(rate).toBeCloseTo(-0.2);
  });
});

describe('rankMerchantsBySpend', () => {
  function tx(
    label: string,
    amountYen: number,
    occurredOn = '2026-08-05',
  ): AccumulationTransaction {
    return {
      categoryId: null,
      amountYen,
      isTransfer: false,
      reviewStatus: 'auto_ok',
      occurredOn,
      label,
    };
  }

  it('店ごとに合計し、金額の大きい順に並べる', () => {
    const result = rankMerchantsBySpend([
      tx('スーパーA', -1_000),
      tx('コンビニB', -5_000),
      tx('スーパーA', -2_000),
    ]);
    expect(result).toEqual([
      { label: 'コンビニB', count: 1, totalYen: 5_000 },
      { label: 'スーパーA', count: 2, totalYen: 3_000 },
    ]);
  });

  it('表記ゆれ(空白・大文字小文字)を同一店としてまとめ、表示は最初の表記を使う', () => {
    const result = rankMerchantsBySpend([tx('Cafe Latte', -500), tx('cafelatte', -700)]);
    expect(result).toEqual([{ label: 'Cafe Latte', count: 2, totalYen: 1_200 }]);
  });

  it('収入・振替・ignored・店名が空の行は除外する', () => {
    const result = rankMerchantsBySpend([
      tx('給与', 300_000),
      { ...tx('振替', -1_000), isTransfer: true },
      { ...tx('除外済み', -1_000), reviewStatus: 'ignored' },
      tx('', -1_000),
    ]);
    expect(result).toEqual([]);
  });

  it('上位N件(既定10件)に絞る', () => {
    const transactions = Array.from({ length: 15 }, (_, i) => tx(`店${i}`, -(i + 1) * 100));
    const result = rankMerchantsBySpend(transactions);
    expect(result).toHaveLength(10);
    expect(result[0]).toEqual({ label: '店14', count: 1, totalYen: 1_500 });
  });
});

describe('projectedMonthTotalYen', () => {
  it('1日あたりのペースを月の総日数まで伸ばす', () => {
    // 10日間で30,000円 = 1日3,000円。30日ある月なら90,000円。
    expect(projectedMonthTotalYen(30_000, 10, 30)).toBe(90_000);
  });

  it('経過日数が0なら、これまでの額をそのまま返す(0除算を避ける)', () => {
    expect(projectedMonthTotalYen(0, 0, 30)).toBe(0);
    expect(projectedMonthTotalYen(5_000, 0, 30)).toBe(5_000);
  });

  it('端数は四捨五入する', () => {
    // 3日で1,000円 = 1日333.33円 → 31日で10,333.33... → 10,333
    expect(projectedMonthTotalYen(1_000, 3, 31)).toBe(10_333);
  });

  it('月が経過し切った(elapsedDays === totalDaysInMonth)場合はそのままの額', () => {
    expect(projectedMonthTotalYen(50_000, 30, 30)).toBe(50_000);
  });
});

describe('averageDailySpendYen', () => {
  it('経過日数で割った1日あたりの額を返す', () => {
    expect(averageDailySpendYen(30_000, 10)).toBe(3_000);
  });

  it('割り切れなくても整数の円になる(formatYen が小数を拒むため)', () => {
    // 10,000 / 3 = 3333.33… を丸める。
    const value = averageDailySpendYen(10_000, 3);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(3_333);
    expect(() => formatYen(value)).not.toThrow();
  });

  it('経過日数が0なら0を返す(0除算を避ける)', () => {
    expect(averageDailySpendYen(0, 0)).toBe(0);
  });
});
