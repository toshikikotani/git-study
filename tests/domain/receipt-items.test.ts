import { describe, expect, it } from 'vitest';

import {
  assertEditableReceiptItems,
  receiptItemsStatus,
  ReceiptItemsError,
} from '@/domain/receipt-items';

describe('receiptItemsStatus', () => {
  it('品目が無ければ none', () => {
    expect(receiptItemsStatus([], -500)).toBe('none');
  });

  it('1件だけでも金額が一致すれば reconciled', () => {
    expect(receiptItemsStatus([{ amountYen: -500 }], -500)).toBe('reconciled');
  });

  it('2件以上で合計が一致すれば reconciled', () => {
    expect(receiptItemsStatus([{ amountYen: -150 }, { amountYen: -630 }], -780)).toBe('reconciled');
  });

  it('合計が一致しなければ mismatched', () => {
    expect(receiptItemsStatus([{ amountYen: -150 }, { amountYen: -999 }], -780)).toBe('mismatched');
  });
});

describe('assertEditableReceiptItems', () => {
  it('名前があり金額が0でなければ通る', () => {
    expect(() => assertEditableReceiptItems([{ name: 'おにぎり', amountYen: -150 }])).not.toThrow();
  });

  it('名前が空ならエラー', () => {
    expect(() => assertEditableReceiptItems([{ name: '  ', amountYen: -150 }])).toThrow(
      ReceiptItemsError,
    );
  });

  it('金額が0円ならエラー', () => {
    expect(() => assertEditableReceiptItems([{ name: 'おにぎり', amountYen: 0 }])).toThrow(
      ReceiptItemsError,
    );
  });
});
