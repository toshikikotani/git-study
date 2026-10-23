import { describe, expect, it } from 'vitest';

import {
  buildAssistantSystemPrompt,
  pickRecentTransactions,
  RECENT_TRANSACTIONS_LIMIT,
} from '@/features/assistant/chat-tools';
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
  monthlySavingsTargetYen: 100000,
  investmentRatioOfSavings: 0.2,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0.3,
  payday: 25,
  sideIncomeSavingsRatio: 0.7,
  aiEnabled: true,
  eveningCheckEnabled: true,
  eveningCheckAt: '21:00',
  receiptCheckLevel: 'normal',
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

const GENRE: Genre = {
  id: 'g1',
  name: '浪費',
  sortOrder: 0,
  budgetYen: 20_000,
  showOnHome: true,
  forecastClosed: false,
};

describe('buildAssistantSystemPrompt', () => {
  it('各ドメインのセクションをすべて含める', () => {
    const prompt = buildAssistantSystemPrompt({
      genres: [GENRE],
      settings: SETTINGS,
      recentTransactions: [TRANSACTION],
      goals: [{ id: 'goal1', title: '旅行' }],
      latestPlan: { id: 'plan1', items: [{ genreId: 'g1', genreName: '浪費', targetYen: 15_000 }] },
      situationText: '今月の貯金: 5,000円',
    });

    expect(prompt).toContain('- 浪費(月次予算=20000円');
    expect(prompt).toContain('給料日=25日');
    expect(prompt).toContain('id=t1');
    expect(prompt).toContain('id=goal1');
    expect(prompt).toContain('目標額=15000円');
    expect(prompt).toContain('今月の貯金: 5,000円');
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
    expect(prompt).toContain('高リスク投資枠を使うかの切り替え');
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
    expect(prompt).toContain('(進行中の貯金目標はありません)');
    expect(prompt).toContain('(支出目標はまだ立てられていません)');
    expect(prompt).toContain('(取得できませんでした)');
  });
});

describe('AIに渡す数字は毎回の最新(ADR-106)', () => {
  const prompt = buildAssistantSystemPrompt({
    genres: [GENRE],
    settings: SETTINGS,
    recentTransactions: [TRANSACTION],
    goals: [],
    latestPlan: null,
    situationText: '今日の日付: 2026-10-17',
    today: '2026-10-17',
  });

  it('会話の前のほうの数字ではなく、発言ごとに計算し直した数字を使うよう伝える', () => {
    expect(prompt).toContain('本人が発言するたびにアプリが明細から計算し直した最新の値');
    expect(prompt).toContain('会話の前のほうに出た数字');
  });

  it('「やばい？」には今日使える目安・今期の見通し・月末に残る見込みを根拠にする', () => {
    expect(prompt).toContain('「今日使える目安」「今期の見通し」');
    expect(prompt).toContain('月末の見込みではないので、それだけで大丈夫とは言わない');
  });
});

describe('pickRecentTransactions(今日の記録を先の予定で押し出さない、ADR-106)', () => {
  const tx = (id: string, occurredOn: string): StoredTransaction => ({
    ...TRANSACTION,
    id,
    occurredOn,
  });

  it('先の予定が多くても、今日と今日までの記録を入れる(予定は31日先まで10件)', () => {
    const future = Array.from({ length: 30 }, (_, i) =>
      tx(`f${i}`, `2026-11-${String(30 - i).padStart(2, '0')}`),
    );
    const past = Array.from({ length: 50 }, (_, i) =>
      tx(`p${i}`, `2026-10-${String(17 - Math.floor(i / 3)).padStart(2, '0')}`),
    );
    const picked = pickRecentTransactions([...future, ...past], '2026-10-17');
    expect(picked).toHaveLength(RECENT_TRANSACTIONS_LIMIT);
    expect(picked.filter((t) => t.occurredOn > '2026-10-17')).toHaveLength(10);
    expect(picked.every((t) => t.occurredOn <= '2026-11-17')).toBe(true);
    expect(picked.some((t) => t.occurredOn === '2026-10-17')).toBe(true);
    // 並びは日付の新しい順のまま
    const dates = picked.map((t) => t.occurredOn);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('よく使うお店をAIに見せる(ADR-107)', () => {
  it('お店がおおまかなら、よく使うお店から選び、ほかの候補も出すよう伝える', () => {
    const prompt = buildAssistantSystemPrompt({
      genres: [GENRE],
      settings: SETTINGS,
      recentTransactions: [],
      goals: [],
      latestPlan: null,
      stores: [
        {
          name: 'セブン-イレブン 渋谷道玄坂店',
          key: 'k',
          chain: 'c',
          type: 'convenience',
          count: 12,
          lastOn: '2026-10-16',
          genreId: 'g1',
          genreName: '浪費',
        },
      ],
      situationText: '',
    });
    expect(prompt).toContain('### よく使うお店');
    expect(prompt).toContain('- "セブン-イレブン 渋谷道玄坂店"(12回 · 浪費)');
    expect(prompt).toContain('store_candidates');
  });
});
