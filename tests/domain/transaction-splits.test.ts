import { describe, expect, it } from 'vitest';

import {
  assertValidSplits,
  expandTransactionsWithSplits,
  TransactionSplitError,
  type TransactionSplitInput,
} from '@/domain/transaction-splits';

function split(categoryId: string | null, amountYen: number): TransactionSplitInput {
  return { categoryId, amountYen, note: null };
}

describe('assertValidSplits', () => {
  it('合計が明細の金額と一致すれば通る', () => {
    expect(() =>
      assertValidSplits([split('cat-food', -3_000), split('cat-daily', -2_000)], -5_000),
    ).not.toThrow();
  });

  it('1件だけの分割はエラー', () => {
    expect(() => assertValidSplits([split('cat-food', -5_000)], -5_000)).toThrow(
      TransactionSplitError,
    );
  });

  it('0件の分割はエラー', () => {
    expect(() => assertValidSplits([], -5_000)).toThrow(TransactionSplitError);
  });

  it('金額が0円の行はエラー', () => {
    expect(() =>
      assertValidSplits([split('cat-food', -5_000), split('cat-daily', 0)], -5_000),
    ).toThrow(TransactionSplitError);
  });

  it('合計が明細の金額と一致しなければエラー', () => {
    expect(() =>
      assertValidSplits([split('cat-food', -3_000), split('cat-daily', -1_000)], -5_000),
    ).toThrow(TransactionSplitError);
  });
});

describe('expandTransactionsWithSplits', () => {
  type Row = { id: string; categoryId: string | null; amountYen: number; label: string };

  it('分割が無い明細はそのまま1行残す', () => {
    const rows: Row[] = [
      { id: 't1', categoryId: 'cat-food', amountYen: -5_000, label: 'スーパー' },
    ];
    const result = expandTransactionsWithSplits(rows, new Map());
    expect(result).toEqual(rows);
  });

  it('分割がある明細は複数行に展開し categoryId/amountYen を差し替える', () => {
    const rows: Row[] = [
      { id: 't1', categoryId: 'cat-food', amountYen: -5_000, label: 'スーパー' },
    ];
    const splitsByTransactionId = new Map([
      [
        't1',
        [
          { categoryId: 'cat-food', amountYen: -3_000 },
          { categoryId: 'cat-daily', amountYen: -2_000 },
        ],
      ],
    ]);
    const result = expandTransactionsWithSplits(rows, splitsByTransactionId);
    expect(result).toEqual([
      { id: 't1', categoryId: 'cat-food', amountYen: -3_000, label: 'スーパー' },
      { id: 't1', categoryId: 'cat-daily', amountYen: -2_000, label: 'スーパー' },
    ]);
  });

  it('分割対象と対象外の明細が混在しても、それぞれ正しく扱う', () => {
    const rows: Row[] = [
      { id: 't1', categoryId: 'cat-food', amountYen: -5_000, label: 'スーパー' },
      { id: 't2', categoryId: 'cat-transport', amountYen: -1_000, label: '電車' },
    ];
    const splitsByTransactionId = new Map([
      [
        't1',
        [
          { categoryId: 'cat-food', amountYen: -3_000 },
          { categoryId: 'cat-daily', amountYen: -2_000 },
        ],
      ],
    ]);
    const result = expandTransactionsWithSplits(rows, splitsByTransactionId);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual(rows[1]);
  });
});
