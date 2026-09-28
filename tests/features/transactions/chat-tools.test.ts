import { describe, expect, it } from 'vitest';

import { ChatToolError } from '@/lib/chat-tools';
import {
  formatTransactionContextLines,
  resolveTransactionById,
} from '@/features/transactions/chat-tools';
import type { StoredTransaction } from '@/features/transactions/types';

/**
 * 「AIに変更を頼む」の明細ドメイン(ADR-054)の純粋な部分。
 * DBにもネットワークにも触れない検証・組み立てだけを試す。
 */

function transaction(overrides: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: 't1',
    accountId: 'a1',
    occurredOn: '2026-09-01',
    description: 'コンビニ',
    merchantName: null,
    amountYen: -500,
    paymentMethod: 'one_time',
    genreId: 'g1',
    genreName: '生活費',
    classifiedBy: 'manual',
    confidence: null,
    reviewStatus: 'auto_ok',
    mustPay: false,
    source: 'manual',
    fingerprint: 'f1',
    batchId: null,
    sourceRef: null,
    memo: null,
    ...overrides,
  };
}

describe('resolveTransactionById', () => {
  const transactions = [transaction({ id: 't1' }), transaction({ id: 't2' })];

  it('一致するidの明細を返す', () => {
    expect(resolveTransactionById('t2', transactions)).toBe(transactions[1]);
  });

  it('見つからないidは拒む', () => {
    expect(() => resolveTransactionById('t9', transactions)).toThrow(ChatToolError);
  });

  it('空・非文字列は拒む', () => {
    expect(() => resolveTransactionById('', transactions)).toThrow(ChatToolError);
    expect(() => resolveTransactionById(undefined, transactions)).toThrow(ChatToolError);
  });
});

describe('formatTransactionContextLines', () => {
  it('明細を箇条書きにする', () => {
    const lines = formatTransactionContextLines([transaction()]);
    expect(lines).toContain('id=t1');
    expect(lines).toContain('コンビニ');
    expect(lines).toContain('-500円');
    expect(lines).toContain('生活費');
  });

  it('未分類・メモ無しの明細を表示する', () => {
    const lines = formatTransactionContextLines([transaction({ genreId: null, genreName: null })]);
    expect(lines).toContain('未分類');
  });

  it('メモがあれば添える', () => {
    const lines = formatTransactionContextLines([transaction({ memo: '按分用' })]);
    expect(lines).toContain('メモ=');
    expect(lines).toContain('按分用');
  });

  it('1件も無ければその旨を書く', () => {
    expect(formatTransactionContextLines([])).toBe('(まだ明細がありません)');
  });
});
