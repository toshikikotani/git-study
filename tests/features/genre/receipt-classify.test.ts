import { describe, expect, it } from 'vitest';

import { buildReceiptTargets } from '@/features/genre/receipt-classify';
import type { ParsedReceiptTransaction } from '@/features/import/receipt-ai';

function transaction(overrides: Partial<ParsedReceiptTransaction>): ParsedReceiptTransaction {
  return {
    occurredOn: '2026-09-28',
    description: 'ファミリーマート',
    amountYen: -300,
    paymentMethod: 'one_time',
    items: [],
    ...overrides,
  } as ParsedReceiptTransaction;
}

describe('buildReceiptTargets', () => {
  it('品目が無い明細は明細全体を1件の分類対象にする', () => {
    expect(buildReceiptTargets([transaction({})])).toEqual([
      { id: '0', label: 'ファミリーマート', amountYen: -300 },
    ]);
  });

  it('品目がある明細は品目ごとに分類対象にし、明細本体は対象にしない', () => {
    const targets = buildReceiptTargets([
      transaction({
        items: [
          { description: 'おにぎり', amountYen: -150, productType: null },
          { description: 'お茶', amountYen: -150, productType: null },
        ],
      }),
      transaction({ description: 'ラーメン店', amountYen: -900 }),
    ] as ParsedReceiptTransaction[]);
    expect(targets.map((t) => t.id)).toEqual(['0:0', '0:1', '1']);
    expect(targets.map((t) => t.label)).toEqual(['おにぎり', 'お茶', 'ラーメン店']);
  });
});
