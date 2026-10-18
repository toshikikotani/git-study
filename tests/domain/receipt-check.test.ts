import { describe, expect, it } from 'vitest';

import {
  applyReceiptFixes,
  isNotItemLine,
  receiptCheckGroups,
  ruleReceiptFixes,
  type ReceiptCheckEntry,
  type ReceiptFix,
} from '@/domain/receipt-check';

/**
 * レシートの品目の読み取りミスを直す(本人の要望「明細のレシート内容もできたらチェックして」、ADR-120)。
 * 候補を出すだけで、保存は本人が選んだものだけ。
 */

function entry(
  items: [string, number][],
  patch: Partial<ReceiptCheckEntry> = {},
): ReceiptCheckEntry {
  return {
    transactionId: 'tx-1',
    occurredOn: '2026-10-17',
    amountYen: -items.reduce((sum, [, yen]) => sum + yen, 0),
    storeName: 'ライフ',
    reconcileDiffYen: null,
    items: items.map(([name, yen], i) => ({
      id: `item-${i}`,
      name,
      amountYen: -yen,
      genreId: i === 0 ? 'food' : null,
      productType: i === 0 ? '乳製品' : null,
    })),
    ...patch,
  };
}

function fix(
  itemId: string,
  kind: ReceiptFix['kind'],
  patch: Partial<ReceiptFix> = {},
): ReceiptFix {
  return {
    key: `ai:tx-1:${itemId}:${kind}`,
    transactionId: 'tx-1',
    itemId,
    kind,
    name: null,
    amountYen: null,
    reason: '理由',
    source: 'ai',
    ...patch,
  };
}

describe('品目ではない行(AI がなくても分かるもの)', () => {
  it('小計・合計・お預り・お釣り・税・対象の行', () => {
    for (const name of [
      '小計',
      '合 計',
      'お買上計',
      'お預り',
      'お預かり金',
      'お釣',
      '釣銭',
      '(内消費税等)',
      '外税',
      '8%対象',
      '＊10%対象計',
      'ポイント利用',
    ])
      expect(isNotItemLine(name), name).toBe(true);
  });

  it('品目の名前に言葉が入っているだけなら品目のまま', () => {
    for (const name of [
      '牛乳',
      'レジ袋',
      '合計3点セット',
      '税込みお弁当',
      '現金書留封筒',
      'ポイントカード',
    ])
      expect(isNotItemLine(name), name).toBe(false);
  });

  it('品目ではない行を消す候補にする。全部が当たるレシートは出さない', () => {
    const fixes = ruleReceiptFixes(
      entry([
        ['牛乳', 200],
        ['小計', 200],
      ]),
    );
    expect(fixes).toEqual([
      expect.objectContaining({ itemId: 'item-1', kind: 'remove', source: 'rule' }),
    ]);
    expect(ruleReceiptFixes(entry([['小計', 200]]))).toEqual([]);
  });
});

describe('候補をレシートごとにまとめる', () => {
  const a = entry([
    ['牛孚L', 200],
    ['小計', 200],
  ]);
  const b = entry([['パン', 150]], { transactionId: 'tx-2' });

  it('明細の並び順で、同じ品目・同じ直し方は先の候補(AI)だけ。無い品目は捨てる', () => {
    const groups = receiptCheckGroups(
      [a, b],
      [
        fix('item-0', 'rename', { name: '牛乳' }),
        fix('item-1', 'remove'),
        fix('item-9', 'remove'),
        { ...fix('item-1', 'remove'), key: 'rule', source: 'rule' },
      ],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entry.transactionId).toBe('tx-1');
    expect(groups[0]!.fixes.map((f) => `${f.itemId}:${f.kind}:${f.source}`)).toEqual([
      'item-0:rename:ai',
      'item-1:remove:ai',
    ]);
  });

  it('全部の行を消すことになるレシートは出さない', () => {
    expect(receiptCheckGroups([a], [fix('item-0', 'remove'), fix('item-1', 'remove')])).toEqual([]);
  });
});

describe('選んだ候補を当てたあとの品目', () => {
  it('品名だけを直すときは、金額・カテゴリ・商品の種類をそのまま残す', () => {
    const e = entry([
      ['牛孚L', 200],
      ['パン', 150],
    ]);
    expect(applyReceiptFixes(e, [fix('item-0', 'rename', { name: '牛乳' })])).toEqual({
      items: [
        { name: '牛乳', amountYen: -200, genreId: 'food', productType: '乳製品' },
        { name: 'パン', amountYen: -150, genreId: null, productType: null },
      ],
      rebalanced: false,
    });
  });

  it('行を消したら、残りの品目の比率で支払額に配り直す(合計 = 支払額を保つ)', () => {
    // 「小計」が品目に入ったまま按分されていた:牛乳 100・パン 50・小計 150、支払 300。
    const e = entry([
      ['牛乳', 100],
      ['パン', 50],
      ['小計', 150],
    ]);
    const result = applyReceiptFixes(e, [fix('item-2', 'remove')])!;
    expect(result.rebalanced).toBe(true);
    expect(result.items.map((i) => i.amountYen)).toEqual([-200, -100]);
  });

  it('金額を直したら、直した金額の比率で配り直す', () => {
    // 「おにぎり 150」を「3」と読み違えたまま按分されていた(支払 300)。
    const e = entry([
      ['おにぎり', 6],
      ['お茶', 294],
    ]);
    const both = applyReceiptFixes(e, [
      fix('item-0', 'amount', { amountYen: 150 }),
      fix('item-1', 'amount', { amountYen: 150 }),
    ])!;
    expect(both.items.map((i) => i.amountYen)).toEqual([-150, -150]);
    expect(both.rebalanced).toBe(true);
    // 片方だけ直しても、合計は支払額のまま。
    const one = applyReceiptFixes(e, [fix('item-0', 'amount', { amountYen: 150 })])!;
    expect(one.items.reduce((sum, i) => sum + i.amountYen, 0)).toBe(-300);
  });

  it('割り勘などで初めから合計が支払額と違うものは、直した金額のまま', () => {
    const e = entry(
      [
        ['牛乳', 200],
        ['小計', 200],
      ],
      { amountYen: -100 },
    );
    const result = applyReceiptFixes(e, [fix('item-1', 'remove')])!;
    expect(result).toEqual({
      items: [{ name: '牛乳', amountYen: -200, genreId: 'food', productType: '乳製品' }],
      rebalanced: false,
    });
  });

  it('配り直すと0円の行ができるときは配り直さない(0円は保存できない)', () => {
    const e = entry([
      ['ガム', 1],
      ['お茶', 2],
    ]);
    const result = applyReceiptFixes(e, [
      fix('item-0', 'amount', { amountYen: 1 }),
      fix('item-1', 'amount', { amountYen: 100_000 }),
    ])!;
    expect(result.rebalanced).toBe(false);
    expect(result.items.map((i) => i.amountYen)).toEqual([-1, -100_000]);
  });

  it('品目が残らないときは保存しない', () => {
    expect(applyReceiptFixes(entry([['小計', 100]]), [fix('item-0', 'remove')])).toBeNull();
  });
});
