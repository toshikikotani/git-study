import { describe, expect, it } from 'vitest';

import { freeAfterReceipt, receiptTotalYen } from '@/domain/receipt-impact';

describe('撮ったレシートの自由残', () => {
  it('読めた金額を自由残から引く。実績には入れない', () => {
    expect(freeAfterReceipt(7900, 2600)).toBe(5300);
    expect(freeAfterReceipt(7900, -2600)).toBe(5300);
  });

  it('複数行のレシートは合計を引く', () => {
    expect(receiptTotalYen([-1800, -800])).toBe(2600);
  });
});
