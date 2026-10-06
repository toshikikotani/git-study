import { describe, expect, it } from 'vitest';

import { assertValidSplits } from '@/domain/transaction-splits';
import { buildFromAiRows } from '@/features/import/receipt-ai';
import { buildReceiptSavePlan } from '@/features/import/receipt-save';

function parsed() {
  const item = (name: string, amount_yen: number, tax_rate: number, y = 0.3) => ({
    name,
    amount_yen,
    product_type: '',
    tax_rate,
    is_discount: false,
    confidence: 0.9,
    y_ratio: y,
  });
  return buildFromAiRows([
    {
      occurred_on: '2026-09-20',
      amount_yen: 1800,
      store_name: 'ココカラファイン阪神大阪梅田駅店',
      payment_method_text: '現金',
      items: [
        item("TULLY'S ラテ", 500, 10),
        item('ハンドクリーム', 700, 10),
        item('メモ帳', 600, 10),
      ],
      expense_subtype: '',
      price_basis: 'tax_included',
      tax_8_yen: 0,
      tax_10_yen: 0,
      points_used_yen: 0,
      coupon_yen: 0,
      store_confidence: 1,
      date_confidence: 1,
      total_confidence: 1,
    },
  ]).transactions[0]!;
}

describe('buildReceiptSavePlan', () => {
  it('店名を正規化して保存し、分割の合計は親の金額に一致、子のジャンルは親を引き継ぐ', () => {
    const t = parsed();
    const plan = buildReceiptSavePlan({
      parsed: t,
      accountId: 'a1',
      parentGenreId: 'g-goods',
      genreByLineId: new Map([['l0', 'g-cafe']]),
      kind: 'normal',
      sourceRef: 'ref-1',
    });
    expect(plan.transaction).toMatchObject({
      merchantName: 'ココカラファイン',
      branchName: '阪神大阪梅田駅店',
      amountYen: -1800,
      genreId: 'g-goods',
      kind: 'normal',
      reconcileDiffYen: null,
    });
    expect(plan.splits?.map((s) => s.genreId)).toEqual(['g-cafe', 'g-goods', 'g-goods']);
    expect(() => assertValidSplits(plan.splits!, plan.transaction.amountYen)).not.toThrow();
    expect(plan.items.every((i) => i.genreId !== null)).toBe(true);
  });

  it('照合が不一致なら差額を明細に残す(要確認カードの元)', () => {
    const t = parsed();
    const mismatched = {
      ...t,
      reconcile: { ...t.reconcile!, status: 'mismatch' as const, diffYen: -150 },
    };
    const plan = buildReceiptSavePlan({
      parsed: mismatched,
      accountId: 'a1',
      parentGenreId: null,
      genreByLineId: new Map(),
      kind: 'special',
      sourceRef: 'ref-2',
    });
    expect(plan.transaction).toMatchObject({ reconcileDiffYen: -150, kind: 'special' });
  });
});
