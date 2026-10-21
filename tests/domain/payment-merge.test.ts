import { describe, expect, it } from 'vitest';

import {
  findMergePairs,
  mergeStoreKey,
  mergedNoteText,
  type MergeCandidate,
} from '@/domain/payment-merge';

/** 同じ支払いを1件にするルール(v4 の共通の土台1、ADR-129)。 */

const c = (over: Partial<MergeCandidate>): MergeCandidate => ({
  id: 'x',
  occurredOn: '2026-10-21',
  amountYen: -453,
  merchantName: 'セブン-イレブン',
  description: '',
  ...over,
});

describe('同じ日・同じ金額・そろえた店名なら1件にまとめる', () => {
  it('レシートとカードの通知メールを組にする(支店・全角半角はそろえる)', () => {
    expect(mergeStoreKey(c({ merchantName: 'セブン-イレブン 渋谷店' }))).toBe(
      mergeStoreKey(c({ merchantName: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ' })),
    );
    const pairs = findMergePairs(
      [c({ id: 'mail', merchantName: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ' })],
      [c({ id: 'receipt', merchantName: 'セブン-イレブン 渋谷店' })],
    );
    expect(pairs.map((p) => [p.payment.id, p.receipt.id])).toEqual([['mail', 'receipt']]);
  });

  it('金額が少し違う・日付がずれる・店名がちがうときはまとめない(重複の候補へ)', () => {
    expect(findMergePairs([c({ id: 'm', amountYen: -460 })], [c({ id: 'r' })])).toEqual([]);
    expect(findMergePairs([c({ id: 'm', occurredOn: '2026-10-20' })], [c({ id: 'r' })])).toEqual(
      [],
    );
    expect(findMergePairs([c({ id: 'm', merchantName: 'ローソン' })], [c({ id: 'r' })])).toEqual(
      [],
    );
  });

  it('相手が2つ以上あるときは、どれとどれか決められないのでまとめない', () => {
    expect(findMergePairs([c({ id: 'm1' }), c({ id: 'm2' })], [c({ id: 'r' })])).toEqual([]);
    expect(findMergePairs([c({ id: 'm' })], [c({ id: 'r1' }), c({ id: 'r2' })])).toEqual([]);
  });

  it('答え合わせのカードの説明', () => {
    expect(mergedNoteText(-453)).toBe(
      'カードの通知メールの453円と同じ支払いなので、1件にまとめました',
    );
  });
});
