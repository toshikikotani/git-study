import { describe, expect, it } from 'vitest';

import { groupAttentionQueue, remainingAttentionQueue } from '@/features/spending/attention-queue';
import { buildAttention } from '@/features/spending/views';
import { ledgerTx } from '../../helpers/ledger';

describe('同じ買い物の確認をまとめる', () => {
  it('未分類と金額不一致を2件と数えず、カテゴリ修正後も差額確認を残す', () => {
    const transactions = [
      ledgerTx({ id: 'both', genreId: null, reconcileDiffYen: 100 }),
      ledgerTx({ id: 'next', genreId: null }),
    ];
    const queue = groupAttentionQueue(transactions, buildAttention(transactions, '2026-09-29'));
    expect(queue).toHaveLength(2);
    expect(queue[0]!.reasons).toEqual(['uncategorized', 'mismatch']);
    const afterGenre = remainingAttentionQueue(queue, new Set(['uncategorized:both']));
    expect(afterGenre[0]!.tx.id).toBe('both');
    expect(afterGenre[0]!.reason).toBe('mismatch');
    const afterBoth = remainingAttentionQueue(
      queue,
      new Set(['uncategorized:both', 'mismatch:both']),
    );
    expect(afterBoth.map((r) => r.tx.id)).toEqual(['next']);
    expect(remainingAttentionQueue(queue, new Set()).map((r) => r.tx.id)).toEqual(['both', 'next']);
  });
});
