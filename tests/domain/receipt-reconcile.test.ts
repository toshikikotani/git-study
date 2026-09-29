import { describe, expect, it } from 'vitest';

import {
  allocateToPayment,
  apportion,
  applyFix,
  reconcileReceipt,
  taxIncludedIn,
  taxOnBase,
  type ReceiptDraft,
  type ReceiptLine,
} from '@/domain/receipt-reconcile';

function line(o: Partial<ReceiptLine> & { id: string; amountYen: number }): ReceiptLine {
  return {
    name: o.id,
    kind: 'item',
    taxRate: 10,
    genreId: null,
    confidence: 1,
    yRatio: null,
    ...o,
  };
}

function draft(o: Partial<ReceiptDraft> & { lines: ReceiptLine[]; paidYen: number }): ReceiptDraft {
  return {
    priceBasis: 'tax_included',
    printedTaxYen: {},
    taxRounding: 'floor',
    pointsYen: 0,
    couponYen: 0,
    roundingAdjustYen: 0,
    ...o,
  };
}

describe('税額の計算', () => {
  it('外税:本体価格 × 税率(既定は切り捨て)', () => {
    expect(taxOnBase(980, 8)).toBe(78); // 78.4
    expect(taxOnBase(980, 10)).toBe(98);
    expect(taxOnBase(105, 8, 'round')).toBe(8); // 8.4
    expect(taxOnBase(105, 8, 'ceil')).toBe(9);
  });

  it('内税:税込価格に含まれる税額', () => {
    expect(taxIncludedIn(108, 8)).toBe(8);
    expect(taxIncludedIn(1100, 10)).toBe(100);
  });
});

describe('apportion(按分)', () => {
  it('合計は必ず total に一致する', () => {
    for (const total of [1, 99, 1000, 5555]) {
      const parts = apportion(total, [3, 5, 7, 11]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('重みが全部0なら均等、負の合計は符号を保つ', () => {
    expect(apportion(10, [0, 0])).toEqual([5, 5]);
    expect(apportion(-10, [1, 1])).toEqual([-5, -5]);
  });
});

describe('reconcileReceipt', () => {
  it('内税・単一税率:品目合計 = 支払額', () => {
    const r = reconcileReceipt(
      draft({
        lines: [line({ id: 'a', amountYen: 500 }), line({ id: 'b', amountYen: 300 })],
        paidYen: 800,
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.diffYen).toBe(0);
  });

  it('外税:品目合計 + 税 = 支払額(8%と10%の混在)', () => {
    // 食品(8%) 1,000円 + 日用品(10%) 500円 → 税 80 + 50、支払 1,630円
    const r = reconcileReceipt(
      draft({
        priceBasis: 'tax_excluded',
        lines: [
          line({ id: 'food', amountYen: 1000, taxRate: 8 }),
          line({ id: 'goods', amountYen: 500, taxRate: 10 }),
        ],
        paidYen: 1630,
      }),
    );
    expect(r.taxYen).toBe(130);
    expect(r.status).toBe('ok');
    expect(r.groups.map((g) => [g.rate, g.taxYen])).toEqual([
      [10, 50],
      [8, 80],
    ]);
  });

  it('印字された税額があれば、計算より優先する', () => {
    const r = reconcileReceipt(
      draft({
        priceBasis: 'tax_excluded',
        printedTaxYen: { 8: 79 },
        lines: [line({ id: 'food', amountYen: 980, taxRate: 8 })],
        paidYen: 1059,
      }),
    );
    expect(r.taxYen).toBe(79);
    expect(r.status).toBe('ok');
  });

  it('税率8%と10%が混在し、値引き行とポイント払いを含むレシートで不一致にならない(受け入れ基準4)', () => {
    // 内税表示: 食品(8%) 648 + 648、日用品(10%) 1,100、8%の値引き -100 → 2,296
    // ポイント 300円 使用 → 支払 1,996円
    const r = reconcileReceipt(
      draft({
        lines: [
          line({ id: 'f1', amountYen: 648, taxRate: 8 }),
          line({ id: 'f2', amountYen: 648, taxRate: 8 }),
          line({ id: 'g1', amountYen: 1100, taxRate: 10 }),
          line({ id: 'd1', amountYen: 100, taxRate: 8, kind: 'discount' }),
        ],
        pointsYen: 300,
        paidYen: 1996,
      }),
    );
    expect(r.itemsYen).toBe(2396);
    expect(r.discountYen).toBe(100);
    expect(r.expectedPaidYen).toBe(1996);
    expect(r.status).toBe('ok');
    expect(r.suggestions).toEqual([]);
  });

  it('外税 + 値引き + ポイント + クーポンの組み合わせ', () => {
    // 8%: 2,000 - 値引き 200 = 1,800 → 税 144。10%: 1,000 → 税 100。
    // 合計 3,044 - ポイント 500 - クーポン 100 = 2,444
    const r = reconcileReceipt(
      draft({
        priceBasis: 'tax_excluded',
        lines: [
          line({ id: 'a', amountYen: 2000, taxRate: 8 }),
          line({ id: 'b', amountYen: 1000, taxRate: 10 }),
          line({ id: 'd', amountYen: 200, kind: 'discount', taxRate: 8 }),
        ],
        pointsYen: 500,
        couponYen: 100,
        paidYen: 2444,
      }),
    );
    expect(r.expectedPaidYen).toBe(2444);
    expect(r.status).toBe('ok');
  });

  it('税率不明の値引きは、税率グループへ品目の大きさで按分する', () => {
    const r = reconcileReceipt(
      draft({
        priceBasis: 'tax_excluded',
        lines: [
          line({ id: 'a', amountYen: 1000, taxRate: 8 }),
          line({ id: 'b', amountYen: 1000, taxRate: 10 }),
          line({ id: 'd', amountYen: 200, kind: 'discount', taxRate: null }),
        ],
        paidYen: 2000 - 200 + 72 + 90,
      }),
    );
    expect(r.discountYen).toBe(200);
    expect(r.status).toBe('ok');
  });

  it('±1円のずれは端数として自動で吸収する', () => {
    const r = reconcileReceipt(draft({ lines: [line({ id: 'a', amountYen: 500 })], paidYen: 501 }));
    expect(r.status).toBe('ok');
    expect(r.absorbedYen).toBe(1);
  });

  it('2円以上ずれたら不一致。差額と修正候補を出す(支払が少ない → 値引きの見落としを勧める)', () => {
    const r = reconcileReceipt(
      draft({ lines: [line({ id: 'a', amountYen: 1000 })], paidYen: 850 }),
    );
    expect(r.status).toBe('mismatch');
    expect(r.diffYen).toBe(-150);
    expect(r.suggestions.map((s) => s.type)).toEqual([
      'add_discount',
      'check_missing_line',
      'adjust_rounding',
    ]);
    expect(r.suggestions.find((s) => s.recommended)?.type).toBe('add_discount');
  });

  it('支払が多い → 行の読み落としを勧める', () => {
    const r = reconcileReceipt(
      draft({ lines: [line({ id: 'a', amountYen: 1000 })], paidYen: 1200 }),
    );
    expect(r.suggestions.find((s) => s.recommended)?.type).toBe('check_missing_line');
  });

  it('修正候補を適用すると一致する(値引き行を追加/端数として調整/読み落とし分の行)', () => {
    const base = draft({ lines: [line({ id: 'a', amountYen: 1000 })], paidYen: 850 });
    for (const type of ['add_discount', 'adjust_rounding'] as const) {
      const fix = reconcileReceipt(base).suggestions.find((s) => s.type === type)!;
      expect(reconcileReceipt(applyFix(base, fix)).status).toBe('ok');
    }
    const more = draft({ lines: [line({ id: 'a', amountYen: 1000 })], paidYen: 1200 });
    const fixMore = reconcileReceipt(more).suggestions.find(
      (s) => s.type === 'check_missing_line',
    )!;
    expect(reconcileReceipt(applyFix(more, fixMore)).status).toBe('ok');
  });

  it('金額が整数でなければ例外', () => {
    expect(() => reconcileReceipt(draft({ lines: [], paidYen: 10.5 }))).toThrow();
  });
});

describe('allocateToPayment(品目を支払額へ按分)', () => {
  it('品目の合計は常に支払額に一致する(ポイント・値引き・外税があっても)', () => {
    const d = draft({
      priceBasis: 'tax_excluded',
      lines: [
        line({ id: 'a', amountYen: 2000, taxRate: 8 }),
        line({ id: 'b', amountYen: 1000, taxRate: 10 }),
        line({ id: 'c', amountYen: 333, taxRate: 10 }),
        line({ id: 'd', amountYen: 200, kind: 'discount', taxRate: 8 }),
      ],
      pointsYen: 500,
      couponYen: 100,
      paidYen: 2444 + 366 - 366 + 0,
    });
    const items = allocateToPayment(d);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items.reduce((a, i) => a + i.amountYen, 0)).toBe(d.paidYen);
  });

  it('不一致のままでも、品目合計は支払額に一致する(子の合計 = 親)', () => {
    const d = draft({
      lines: [line({ id: 'a', amountYen: 1000 }), line({ id: 'b', amountYen: 500 })],
      paidYen: 1234,
    });
    expect(reconcileReceipt(d).status).toBe('mismatch');
    expect(allocateToPayment(d).reduce((a, i) => a + i.amountYen, 0)).toBe(1234);
  });

  it('値引きが無ければ、税込の各品目の金額はそのまま', () => {
    const d = draft({
      lines: [line({ id: 'a', amountYen: 500 }), line({ id: 'b', amountYen: 300 })],
      paidYen: 800,
    });
    expect(allocateToPayment(d).map((i) => i.amountYen)).toEqual([500, 300]);
  });

  it('特定の品目に掛かる値引きは、その品目から引く', () => {
    const d = draft({
      lines: [
        line({ id: 'a', amountYen: 500 }),
        line({ id: 'b', amountYen: 300 }),
        line({ id: 'd', amountYen: 100, kind: 'discount', taxRate: null, appliesToLineId: 'a' }),
      ],
      paidYen: 700,
    });
    expect(allocateToPayment(d).map((i) => i.amountYen)).toEqual([400, 300]);
  });

  it('品目が無い・支払額が0以下なら空', () => {
    expect(allocateToPayment(draft({ lines: [], paidYen: 100 }))).toEqual([]);
    expect(
      allocateToPayment(draft({ lines: [line({ id: 'a', amountYen: 5 })], paidYen: 0 })),
    ).toEqual([]);
  });
});
