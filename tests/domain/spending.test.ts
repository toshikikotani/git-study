import { describe, expect, it } from 'vitest';

import { summarizeMonthlySpendByCategory, type SpendingTransaction } from '@/domain/spending';

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
