import { describe, expect, it } from 'vitest';

import { buildAssistantSystemPrompt } from '@/features/assistant/chat-tools';
import type { AppSettings } from '@/features/settings/store';
import type { StoredTransaction } from '@/features/transactions/types';

/**
 * 「AIに変更を頼む」の統合部分(ADR-054)。各ドメインの純粋な部分を
 * 束ねてシステムプロンプトを組み立てる、その合成だけを試す
 * (各セクションの中身自体は features/{classification,settings,transactions}/
 * chat-tools.ts 側でテストする)。
 */

const SETTINGS: AppSettings = {
  monthlyRepaymentTargetYen: 100000,
  repaymentStrategy: 'avalanche',
  investmentRatioOfRepayment: 0.2,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0.3,
  payday: 25,
  sideIncomeRepaymentRatio: 0.7,
};

const TRANSACTION: StoredTransaction = {
  id: 't1',
  accountId: 'a1',
  occurredOn: '2026-09-01',
  description: 'コンビニ',
  merchantName: null,
  amountYen: -500,
  paymentMethod: 'one_time',
  categoryId: 'c1',
  categoryName: '生活費',
  matchedRuleId: null,
  classifiedBy: 'manual',
  confidence: null,
  reviewStatus: 'auto_ok',
  source: 'manual',
  fingerprint: 'f1',
  batchId: null,
  sourceRef: null,
  memo: null,
};

describe('buildAssistantSystemPrompt', () => {
  it('各ドメインのセクションをすべて含める', () => {
    const prompt = buildAssistantSystemPrompt({
      categories: [{ id: 'c1', name: '浪費' }],
      rules: [
        {
          id: 'r1',
          name: '学習: スタバ',
          matchType: 'keyword',
          pattern: 'スタバ',
          categoryName: '浪費',
          isActive: true,
          isProtected: false,
        },
      ],
      settings: SETTINGS,
      recentTransactions: [TRANSACTION],
    });

    expect(prompt).toContain('- 浪費');
    expect(prompt).toContain('id=r1');
    expect(prompt).toContain('給料日=25日');
    expect(prompt).toContain('id=t1');
    expect(prompt).toContain('update_settings');
    expect(prompt).toContain('update_receipt_items');
    expect(prompt).toContain('set_expense_subtype');
  });

  it('空のカテゴリ・ルール・明細でも組み立てられる', () => {
    const prompt = buildAssistantSystemPrompt({
      categories: [],
      rules: [],
      settings: SETTINGS,
      recentTransactions: [],
    });
    expect(prompt).toContain('(まだ1件もありません)');
    expect(prompt).toContain('(まだ明細がありません)');
  });
});
