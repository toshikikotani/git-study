import { describe, expect, it } from 'vitest';

import {
  findDuplicateCandidates,
  duplicatePairKey,
  duplicatePairSignature,
  type MatchableTransaction,
  type TransactionSource,
} from '@/domain/duplicate-match';

function tx(
  id: string,
  occurredOn: string,
  amountYen: number,
  source: TransactionSource,
  overrides: Partial<MatchableTransaction> = {},
): MatchableTransaction {
  return {
    id,
    occurredOn,
    amountYen,
    source,
    categoryId: null,
    isTransfer: false,
    reviewStatus: 'auto_ok',
    ...overrides,
  };
}

describe('findDuplicateCandidates', () => {
  it('同額・近い日付・別経路の2件をペアにする', () => {
    const result = findDuplicateCandidates([
      tx('receipt', '2026-09-05', -1_280, 'manual'),
      tx('mail', '2026-09-06', -1_280, 'gmail'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.earlier.id).toBe('receipt');
    expect(result[0]?.later.id).toBe('mail');
    expect(result[0]?.dayGap).toBe(1);
  });

  it('同じ経路どうしの同額はペアにしない(同じ店で2回買っただけの可能性が高い)', () => {
    const result = findDuplicateCandidates([
      tx('a', '2026-09-05', -500, 'manual'),
      tx('b', '2026-09-06', -500, 'manual'),
    ]);
    expect(result).toEqual([]);
  });

  it('金額が1円でも違えばペアにしない', () => {
    const result = findDuplicateCandidates([
      tx('a', '2026-09-05', -1_280, 'manual'),
      tx('b', '2026-09-05', -1_281, 'gmail'),
    ]);
    expect(result).toEqual([]);
  });

  it('日付が離れすぎていればペアにしない', () => {
    const result = findDuplicateCandidates([
      tx('a', '2026-09-01', -1_280, 'manual'),
      tx('b', '2026-09-05', -1_280, 'gmail'),
    ]);
    expect(result).toEqual([]);
  });

  it('日付の許容幅は上書きできる', () => {
    const result = findDuplicateCandidates(
      [tx('a', '2026-09-01', -1_280, 'manual'), tx('b', '2026-09-05', -1_280, 'gmail')],
      { maxDayGap: 4 },
    );
    expect(result).toHaveLength(1);
  });

  it('口座が違ってもペアにする(レシートは本人が口座を選び、メールは固定のため)', () => {
    const result = findDuplicateCandidates([
      tx('receipt', '2026-09-05', -1_280, 'manual'),
      tx('mail', '2026-09-05', -1_280, 'gmail'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.dayGap).toBe(0);
  });

  it('振替・ignored・収入は対象外', () => {
    const result = findDuplicateCandidates([
      tx('a', '2026-09-05', -1_280, 'manual', { isTransfer: true }),
      tx('b', '2026-09-05', -1_280, 'gmail', { isTransfer: true }),
      tx('c', '2026-09-05', -900, 'manual', { reviewStatus: 'ignored' }),
      tx('d', '2026-09-05', -900, 'gmail', { reviewStatus: 'ignored' }),
      tx('e', '2026-09-05', 700, 'manual'),
      tx('f', '2026-09-05', 700, 'gmail'),
    ]);
    expect(result).toEqual([]);
  });

  it('既にペアになった明細は別のペアに再利用しない', () => {
    const result = findDuplicateCandidates([
      tx('a', '2026-09-05', -1_000, 'manual'),
      tx('b', '2026-09-05', -1_000, 'gmail'),
      tx('c', '2026-09-05', -1_000, 'csv'),
    ]);

    expect(result).toHaveLength(1);
    const usedIds = [result[0]!.earlier.id, result[0]!.later.id];
    expect(usedIds).toEqual(['a', 'b']);
  });

  it('新しい順に返す', () => {
    const result = findDuplicateCandidates([
      tx('old1', '2026-09-01', -500, 'manual'),
      tx('old2', '2026-09-01', -500, 'gmail'),
      tx('new1', '2026-09-20', -700, 'manual'),
      tx('new2', '2026-09-20', -700, 'gmail'),
    ]);

    expect(result.map((c) => c.earlier.id)).toEqual(['new1', 'old1']);
  });

  it('候補が無ければ空配列', () => {
    expect(findDuplicateCandidates([])).toEqual([]);
  });

  it('別物と判断したペアを再表示せず、同じ明細と第三の相手は確認できる', () => {
    const a = tx('a', '2026-09-05', -1000, 'manual');
    const b = tx('b', '2026-09-05', -1000, 'gmail');
    const c = tx('c', '2026-09-05', -1000, 'csv');
    const result = findDuplicateCandidates([a, b, c], {
      distinctPairSignatures: new Set([duplicatePairSignature(a, b)]),
    });
    expect(result.map((pair) => [pair.earlier.id, pair.later.id])).toEqual([['a', 'c']]);
    expect([a, b, c].map((item) => item.reviewStatus)).toEqual(['auto_ok', 'auto_ok', 'auto_ok']);
  });

  it('ペアの順序によらず同じ判断を引き継ぐ', () => {
    const a = tx('a', '2026-09-05', -1000, 'manual');
    const b = tx('b', '2026-09-06', -1000, 'gmail');
    expect(duplicatePairKey(a, b)).toBe(duplicatePairKey(b, a));
    expect(duplicatePairSignature(a, b)).toBe(duplicatePairSignature(b, a));
    expect(
      findDuplicateCandidates([b, a], {
        distinctPairSignatures: new Set([duplicatePairSignature(b, a)]),
      }),
    ).toEqual([]);
  });

  it.each(['date', 'amount', 'source'])('%sの変更後は古い判断で隠さない', (field) => {
    const a = tx('a', '2026-09-05', -1000, 'manual');
    const b = tx('b', '2026-09-06', -1000, 'gmail');
    const previous = duplicatePairSignature(a, b);
    const updatedA = {
      ...a,
      ...(field === 'date' ? { occurredOn: '2026-09-04' } : {}),
      ...(field === 'amount' ? { amountYen: -900 } : {}),
      ...(field === 'source' ? { source: 'csv' as const } : {}),
    };
    const updatedB = { ...b, ...(field === 'amount' ? { amountYen: -900 } : {}) };
    expect(
      findDuplicateCandidates([updatedA, updatedB], {
        distinctPairSignatures: new Set([previous]),
      }),
    ).toHaveLength(1);
  });
});
