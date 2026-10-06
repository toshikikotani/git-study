import { describe, expect, it } from 'vitest';

import {
  detectSubscriptions,
  splitFixedVariable,
  subscriptionKeyOf,
  type SubscriptionTransaction,
} from '@/domain/subscriptions';

function tx(
  overrides: Partial<SubscriptionTransaction> & { occurredOn: string },
): SubscriptionTransaction {
  return {
    merchantName: 'Netflix',
    description: 'NETFLIX.COM',
    amountYen: -1_980,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    ...overrides,
  };
}

describe('detectSubscriptions', () => {
  it('同じ店・同じ金額がほぼ1ヶ月おきに2回以上続けば検知する', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01' }),
      tx({ occurredOn: '2026-08-01' }),
      tx({ occurredOn: '2026-09-01' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      label: 'Netflix',
      amountYen: 1_980,
      occurrenceCount: 3,
      lastOccurredOn: '2026-09-01',
      nextExpectedOn: '2026-10-01',
    });
  });

  it('1回しか無い場合は検知しない', () => {
    const result = detectSubscriptions([tx({ occurredOn: '2026-09-01' })]);
    expect(result).toEqual([]);
  });

  it('間隔が短すぎる(月2回等)場合は検知しない', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-09-01' }),
      tx({ occurredOn: '2026-09-10' }),
    ]);
    expect(result).toEqual([]);
  });

  it('間隔が空きすぎた場合は連続とみなさない', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-01-01' }),
      tx({ occurredOn: '2026-09-01' }),
    ]);
    expect(result).toEqual([]);
  });

  it('振替は対象外', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', isTransfer: true }),
      tx({ occurredOn: '2026-08-01', isTransfer: true }),
    ]);
    expect(result).toEqual([]);
  });

  it('ignored は対象外', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', reviewStatus: 'ignored' }),
      tx({ occurredOn: '2026-08-01', reviewStatus: 'ignored' }),
    ]);
    expect(result).toEqual([]);
  });

  it('収入(金額が正)は対象外', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', amountYen: 1_980 }),
      tx({ occurredOn: '2026-08-01', amountYen: 1_980 }),
    ]);
    expect(result).toEqual([]);
  });

  it('価格改定があると別グループとして扱い、新価格は検知に2回必要', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', amountYen: -1_980 }),
      tx({ occurredOn: '2026-08-01', amountYen: -1_980 }),
      tx({ occurredOn: '2026-09-01', amountYen: -2_490 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.amountYen).toBe(1_980);
    expect(result[0]?.occurrenceCount).toBe(2);
  });

  it('店名が無い場合は摘要(description)を使う', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', merchantName: null, description: 'SPOTIFY JAPAN' }),
      tx({ occurredOn: '2026-08-01', merchantName: null, description: 'SPOTIFY JAPAN' }),
    ]);
    expect(result[0]?.label).toBe('SPOTIFY JAPAN');
  });

  it('複数の店が混在していても、それぞれ独立して検知する', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-07-01', merchantName: 'Netflix' }),
      tx({ occurredOn: '2026-08-01', merchantName: 'Netflix' }),
      tx({ occurredOn: '2026-07-15', merchantName: 'Spotify', amountYen: -980 }),
      tx({ occurredOn: '2026-08-15', merchantName: 'Spotify', amountYen: -980 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.label).sort()).toEqual(['Netflix', 'Spotify']);
  });

  it('結果は最終発生日の新しい順にソートされる', () => {
    const result = detectSubscriptions([
      tx({ occurredOn: '2026-06-01', merchantName: 'Old', amountYen: -500 }),
      tx({ occurredOn: '2026-07-01', merchantName: 'Old', amountYen: -500 }),
      tx({ occurredOn: '2026-08-01', merchantName: 'New', amountYen: -700 }),
      tx({ occurredOn: '2026-09-01', merchantName: 'New', amountYen: -700 }),
    ]);
    expect(result.map((r) => r.label)).toEqual(['New', 'Old']);
  });
});

describe('subscriptionKeyOf', () => {
  it('店名・金額が同じなら同じキーになる', () => {
    expect(subscriptionKeyOf('Netflix', 'NETFLIX.COM', -1980)).toBe(
      subscriptionKeyOf('Netflix', '違う摘要', -1980),
    );
  });

  it('金額が違えば違うキーになる', () => {
    expect(subscriptionKeyOf('Netflix', '', -1980)).not.toBe(
      subscriptionKeyOf('Netflix', '', -2480),
    );
  });

  it('空白・大文字小文字の違いを無視する', () => {
    expect(subscriptionKeyOf('Netflix Japan', '', -100)).toBe(
      subscriptionKeyOf('netflixjapan', '', -100),
    );
  });

  it('merchantNameが無ければdescriptionを使う', () => {
    expect(subscriptionKeyOf(null, 'NETFLIX.COM', -1980)).toBe(
      subscriptionKeyOf('NETFLIX.COM', '別の摘要', -1980),
    );
  });
});

describe('splitFixedVariable(N4「固定費/変動費」)', () => {
  it('確認済みキーに一致する明細だけが固定費になる', () => {
    const netflix = { merchantName: 'Netflix', description: '', amountYen: -1980 };
    const lawson = { merchantName: 'ローソン', description: '', amountYen: -500 };
    const confirmedKeys = new Set([subscriptionKeyOf('Netflix', '', -1980)]);

    const result = splitFixedVariable([netflix, lawson], confirmedKeys);

    expect(result.fixedYen).toBe(1980);
    expect(result.variableYen).toBe(500);
    expect(result.fixed).toEqual([netflix]);
    expect(result.variable).toEqual([lawson]);
  });

  it('確認済みキーが無ければすべて変動費', () => {
    const result = splitFixedVariable(
      [{ merchantName: 'A', description: '', amountYen: -100 }],
      new Set(),
    );
    expect(result.fixedYen).toBe(0);
    expect(result.variableYen).toBe(100);
  });

  it('収入(正の金額)は対象外', () => {
    const result = splitFixedVariable(
      [{ merchantName: '給与', description: '', amountYen: 300000 }],
      new Set(),
    );
    expect(result.fixedYen).toBe(0);
    expect(result.variableYen).toBe(0);
  });
});
