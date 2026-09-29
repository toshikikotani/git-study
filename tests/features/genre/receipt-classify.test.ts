import { describe, expect, it } from 'vitest';

import { buildReceiptTargets, classifyReceiptPipeline } from '@/features/genre/receipt-classify';
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

describe('classifyReceiptPipeline(受け入れ基準3)', () => {
  const genreOptions = [
    { id: 'g-goods', name: '日用品' },
    { id: 'g-cafe', name: 'カフェ・飲料' },
    { id: 'g-food', name: '食料品' },
  ];

  it("ココカラファインの分割レシート:未分類の子が出ず、TULLY'S はカフェ・飲料になる", async () => {
    const t = transaction({
      description: 'ココカラファイン阪神大阪梅田駅店',
      storeName: 'ココカラファイン',
      amountYen: -1500,
      items: [
        { description: "TULLY'S ハニーラテ", amountYen: -500, productType: null },
        { description: 'ハンドクリーム', amountYen: -700, productType: null },
        { description: '不明な商品XYZ', amountYen: -300, productType: null },
      ],
    } as Partial<ParsedReceiptTransaction>);
    // AI なし(apiKey=null)でも、すべての品目にジャンルが付く
    const result = await classifyReceiptPipeline(null, [t], genreOptions, new Map());
    const byKey = new Map(result.classifications.map((c) => [c.key, c]));
    expect(byKey.get('0:0')).toMatchObject({ genreId: 'g-cafe', source: 'dictionary' });
    expect(byKey.get('0:2')).toMatchObject({ genreId: 'g-goods', source: 'store_type' }); // 親(ドラッグストア=日用品)を引き継ぐ
    for (const key of ['0:0', '0:1', '0:2']) expect(byKey.has(key)).toBe(true);
    expect(result.parentGenreIds.get(0)).toBe('g-goods');
  });
});
