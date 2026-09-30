import { describe, expect, it } from 'vitest';

import { buildAssistantSystemPrompt } from '@/features/assistant/chat-tools';
import type { Genre } from '@/features/genre/store';
import type { AppSettings } from '@/features/settings/store';
import type { StoredTransaction } from '@/features/transactions/types';

/**
 * AIの窓口の統合部分(ADR-054 → ADR-059)。各ドメインの純粋な部分を
 * 束ねてシステムプロンプトを組み立てる、その合成だけを試す
 * (各セクションの中身自体は features/{genre,settings,transactions}/
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
  aiEnabled: true,
};

const TRANSACTION: StoredTransaction = {
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
};

const GENRE: Genre = { id: 'g1', name: '浪費', sortOrder: 0, budgetYen: 20_000, showOnHome: true };

describe('buildAssistantSystemPrompt', () => {
  it('各ドメインのセクションをすべて含める', () => {
    const prompt = buildAssistantSystemPrompt({
      genres: [GENRE],
      settings: SETTINGS,
      recentTransactions: [TRANSACTION],
      goals: [{ id: 'goal1', title: '旅行', currentAmountYen: 5_000 }],
      latestPlan: { id: 'plan1', items: [{ genreId: 'g1', genreName: '浪費', targetYen: 15_000 }] },
      situationText: '完済まで: 100日',
    });

    expect(prompt).toContain('- 浪費(月次予算=20000円');
    expect(prompt).toContain('給料日=25日');
    expect(prompt).toContain('id=t1');
    expect(prompt).toContain('id=goal1');
    expect(prompt).toContain('目標額=15000円');
    expect(prompt).toContain('完済まで: 100日');
    expect(prompt).toContain('ask_user');
  });

  it('致命的な変更ができないことを本人向けの断り文として明記する', () => {
    const prompt = buildAssistantSystemPrompt({
      genres: [],
      settings: SETTINGS,
      recentTransactions: [],
      goals: [],
      latestPlan: null,
      situationText: '',
    });
    expect(prompt).toContain('削除すべて');
    expect(prompt).toContain('高リスク投資枠の解禁');
    expect(prompt).toContain('リボ払い');
  });

  it('空のジャンル・明細・目標でも組み立てられる', () => {
    const prompt = buildAssistantSystemPrompt({
      genres: [],
      settings: SETTINGS,
      recentTransactions: [],
      goals: [],
      latestPlan: null,
      situationText: '',
    });
    expect(prompt).toContain('(まだ1件もありません)');
    expect(prompt).toContain('(まだ明細がありません)');
    expect(prompt).toContain('(進行中の目標はありません)');
    expect(prompt).toContain('(支出目標はまだ立てられていません)');
    expect(prompt).toContain('(取得できませんでした)');
  });
});
