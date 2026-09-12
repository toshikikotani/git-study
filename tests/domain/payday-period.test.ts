import { describe, expect, it } from 'vitest';

import {
  sumByAccount,
  sumByCategory,
  totalSpending,
  type PeriodTransaction,
} from '@/domain/payday-period';

function tx(overrides: Partial<PeriodTransaction>): PeriodTransaction {
  return {
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amountYen: -1000,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    ...overrides,
  };
}

describe('sumByAccount', () => {
  it('口座ごとに使用金額(正の数)を合計する', () => {
    const map = sumByAccount([
      tx({ accountId: 'acc-1', amountYen: -1000 }),
      tx({ accountId: 'acc-1', amountYen: -500 }),
      tx({ accountId: 'acc-2', amountYen: -2000 }),
    ]);
    expect(map.get('acc-1')).toBe(1500);
    expect(map.get('acc-2')).toBe(2000);
  });

  it('口座間振替は除外する', () => {
    const map = sumByAccount([tx({ accountId: 'acc-1', amountYen: -1000, isTransfer: true })]);
    expect(map.get('acc-1')).toBeUndefined();
  });

  it('review_status = ignored は除外する', () => {
    const map = sumByAccount([tx({ accountId: 'acc-1', reviewStatus: 'ignored' })]);
    expect(map.get('acc-1')).toBeUndefined();
  });

  it('収入(amountYen > 0)は使用金額に混ぜない', () => {
    const map = sumByAccount([tx({ accountId: 'acc-1', amountYen: 50000 })]);
    expect(map.get('acc-1')).toBeUndefined();
  });
});

describe('sumByCategory', () => {
  it('カテゴリごとに合計する。未分類(null)もキーとして持つ', () => {
    const map = sumByCategory([
      tx({ categoryId: 'cat-1', amountYen: -1000 }),
      tx({ categoryId: null, amountYen: -300 }),
    ]);
    expect(map.get('cat-1')).toBe(1000);
    expect(map.get(null)).toBe(300);
  });
});

describe('totalSpending', () => {
  it('期間全体の使用金額合計を返す', () => {
    const total = totalSpending([
      tx({ amountYen: -1000 }),
      tx({ amountYen: -500 }),
      tx({ amountYen: 50000 }), // 収入は含まない
      tx({ amountYen: -300, isTransfer: true }), // 振替は含まない
    ]);
    expect(total).toBe(1500);
  });

  it('対象が無ければ0', () => {
    expect(totalSpending([])).toBe(0);
  });
});
