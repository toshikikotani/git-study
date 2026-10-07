import { describe, expect, it } from 'vitest';

import {
  isWriteToolName,
  MAX_AMOUNT_YEN,
  parseAskUser,
  planToolCall,
  WRITE_TOOL_NAMES,
  type PlanContext,
} from '@/features/assistant/plan';
import type { Genre } from '@/features/genre/store';
import type { AppSettings } from '@/features/settings/store';
import type { StoredTransaction } from '@/features/transactions/types';
import { ChatToolError } from '@/lib/chat-tools';

/**
 * AIの窓口の「計画層」(ADR-059)。モデルの出力・承認時にクライアントから戻ってきた
 * 値を、実行できる形へ変換する関所であり、致命的な変更(本人の条件)を拒む最終的な
 * 保証もここになる。
 */

const SETTINGS: AppSettings = {
  monthlySavingsTargetYen: 100_000,
  investmentRatioOfSavings: 0.2,
  isHighRiskUnlocked: false,
  highRiskAllocationRatio: 0.3,
  payday: 25,
  sideIncomeSavingsRatio: 0.7,
  aiEnabled: true,
};

const GENRES: Genre[] = [
  {
    id: 'g-food',
    name: '食料品',
    sortOrder: 0,
    budgetYen: 30_000,
    showOnHome: true,
    forecastClosed: false,
  },
  {
    id: 'g-out',
    name: '外食',
    sortOrder: 1,
    budgetYen: null,
    showOnHome: false,
    forecastClosed: false,
  },
];

const TRANSACTION: StoredTransaction = {
  id: 't1',
  accountId: 'a1',
  occurredOn: '2026-09-01',
  description: 'コンビニ',
  merchantName: null,
  amountYen: -500,
  paymentMethod: 'one_time',
  genreId: 'g-food',
  genreName: '食料品',
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

const CTX: PlanContext = {
  genres: GENRES,
  settings: SETTINGS,
  transactions: [TRANSACTION],
  goals: [{ id: 'goal1', title: '旅行' }],
  latestPlan: {
    id: 'plan1',
    items: [
      { genreId: 'g-food', genreName: '食料品', targetYen: 30_000 },
      { genreId: 'g-out', genreName: '外食', targetYen: 10_000 },
    ],
  },
};

describe('planToolCall: update_settings', () => {
  it('変更前→変更後を見せる説明と、実行用のpatchを返す', () => {
    const { change, operation } = planToolCall(
      'update_settings',
      { payday: 20, monthly_savings_target_yen: 80_000 },
      CTX,
    );
    expect(change.target).toBe('設定');
    expect(change.detail).toContain('給料日: 25日→20日');
    expect(change.detail).toContain('100,000円→80,000円');
    expect(operation).toEqual({
      op: 'update_settings',
      patch: { payday: 20, monthlySavingsTargetYen: 80_000 },
    });
  });

  it('高リスク投資枠の切り替えは会話から変えられない(致命的な変更の禁止)', () => {
    expect(() => planToolCall('update_settings', { is_high_risk_unlocked: true }, CTX)).toThrow(
      ChatToolError,
    );
  });

  it('毎月の貯金目標の上限を超える値は拒む', () => {
    expect(() =>
      planToolCall('update_settings', { monthly_savings_target_yen: MAX_AMOUNT_YEN + 1 }, CTX),
    ).toThrow(ChatToolError);
  });

  it('1項目も無ければ拒む', () => {
    expect(() => planToolCall('update_settings', {}, CTX)).toThrow(ChatToolError);
  });
});

describe('planToolCall: update_transaction', () => {
  it('ジャンルと金額を変える案に、前後の値が入る', () => {
    const { change, operation } = planToolCall(
      'update_transaction',
      { transaction_id: 't1', genre_name: '外食', amount_yen: -800 },
      CTX,
    );
    expect(change.detail).toContain('ジャンル: 食料品→外食');
    expect(change.detail).toContain('金額: -500円→-800円');
    expect(operation).toEqual({
      op: 'update_transaction',
      transactionId: 't1',
      core: { genreId: 'g-out', amountAndDate: { amountYen: -800, occurredOn: '2026-09-01' } },
      memo: null,
    });
  });

  it('メモだけの変更では core を持たない', () => {
    const { operation } = planToolCall(
      'update_transaction',
      { transaction_id: 't1', memo: '会社の飲み会' },
      CTX,
    );
    expect(operation).toMatchObject({ op: 'update_transaction', core: null, memo: '会社の飲み会' });
  });

  it('存在しない明細idと、桁を外した金額は拒む', () => {
    expect(() =>
      planToolCall('update_transaction', { transaction_id: 'nope', memo: 'x' }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall(
        'update_transaction',
        { transaction_id: 't1', amount_yen: -(MAX_AMOUNT_YEN + 1) },
        CTX,
      ),
    ).toThrow(ChatToolError);
  });

  it('金額0は拒む', () => {
    expect(() =>
      planToolCall('update_transaction', { transaction_id: 't1', amount_yen: 0 }, CTX),
    ).toThrow(ChatToolError);
  });
});

describe('planToolCall: ジャンル', () => {
  it('予算を変える案は前後の値を見せ、nullは無制限になる', () => {
    const changed = planToolCall(
      'update_genre_budget',
      { genre_name: '食料品', budget_yen: 25_000 },
      CTX,
    );
    expect(changed.change.detail).toBe('月次予算: 30,000円→25,000円');
    expect(changed.operation).toEqual({
      op: 'update_genre_budget',
      genreId: 'g-food',
      budgetYen: 25_000,
    });

    const cleared = planToolCall(
      'update_genre_budget',
      { genre_name: '食料品', budget_yen: null },
      CTX,
    );
    expect(cleared.change.detail).toBe('月次予算: 30,000円→無制限');
    expect(cleared.operation).toMatchObject({ budgetYen: null });
  });

  it('未知のジャンル・負の予算・上限超過は拒む', () => {
    expect(() =>
      planToolCall('update_genre_budget', { genre_name: '存在しない', budget_yen: 1 }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall('update_genre_budget', { genre_name: '食料品', budget_yen: -1 }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall(
        'update_genre_budget',
        { genre_name: '食料品', budget_yen: MAX_AMOUNT_YEN + 1 },
        CTX,
      ),
    ).toThrow(ChatToolError);
  });

  it('ホーム表示の切り替え', () => {
    const { change } = planToolCall(
      'set_genre_show_on_home',
      { genre_name: '外食', show_on_home: true },
      CTX,
    );
    expect(change.detail).toContain('出さない→出す');
    expect(() =>
      planToolCall('set_genre_show_on_home', { genre_name: '外食', show_on_home: 'yes' }, CTX),
    ).toThrow(ChatToolError);
  });

  it('ジャンル追加は既存名と重複できない', () => {
    expect(planToolCall('create_genre', { name: '交際費' }, CTX).operation).toEqual({
      op: 'create_genre',
      name: '交際費',
    });
    expect(() => planToolCall('create_genre', { name: '食料品' }, CTX)).toThrow(ChatToolError);
    expect(() => planToolCall('create_genre', { name: '' }, CTX)).toThrow(ChatToolError);
  });
});

describe('planToolCall: 目標', () => {
  it('目標を作る案(金額・期限は任意)', () => {
    const { change, operation } = planToolCall(
      'create_goal',
      { title: '旅行費用を貯める', target_amount_yen: 200_000, target_date: '2027-03-31' },
      CTX,
    );
    expect(change.kind).toBe('created');
    expect(change.detail).toContain('200,000円');
    expect(operation).toEqual({
      op: 'create_goal',
      title: '旅行費用を貯める',
      targetAmountYen: 200_000,
      targetDate: '2027-03-31',
    });
    expect(planToolCall('create_goal', { title: '貯金' }, CTX).operation).toMatchObject({
      targetAmountYen: null,
      targetDate: null,
    });
  });

  it('不正なタイトル・金額・期限は拒む', () => {
    expect(() => planToolCall('create_goal', { title: '' }, CTX)).toThrow(ChatToolError);
    expect(() => planToolCall('create_goal', { title: 'x', target_amount_yen: 0 }, CTX)).toThrow(
      ChatToolError,
    );
    expect(() => planToolCall('create_goal', { title: 'x', target_date: '来月' }, CTX)).toThrow(
      ChatToolError,
    );
  });

  it('進捗を手で変えるツールは無い(貯金は収入 − 支出から自動で数える)', () => {
    expect(() =>
      planToolCall('update_goal_progress', { goal_id: 'goal1', current_amount_yen: 1 }, CTX),
    ).toThrow(ChatToolError);
  });
});

describe('planToolCall: 支出目標の調整', () => {
  it('直近の目標に含まれるジャンルの目標額だけを変えられる', () => {
    const { change, operation } = planToolCall(
      'update_plan_targets',
      {
        items: [
          { genre_name: '食料品', target_yen: 27_000 },
          { genre_name: '外食', target_yen: 8_000 },
        ],
      },
      CTX,
    );
    expect(change.detail).toContain('食料品: 30,000円→27,000円');
    expect(change.detail).toContain('合計: 40,000円→35,000円');
    expect(operation).toEqual({
      op: 'update_plan_targets',
      planId: 'plan1',
      items: [
        { genreId: 'g-food', targetYen: 27_000 },
        { genreId: 'g-out', targetYen: 8_000 },
      ],
    });
  });

  it('目標が無い・含まれないジャンル・負の額は拒む', () => {
    expect(() =>
      planToolCall(
        'update_plan_targets',
        { items: [{ genre_name: '食料品', target_yen: 1 }] },
        { ...CTX, latestPlan: null },
      ),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall('update_plan_targets', { items: [{ genre_name: '酒', target_yen: 1 }] }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall(
        'update_plan_targets',
        { items: [{ genre_name: '食料品', target_yen: -1 }] },
        CTX,
      ),
    ).toThrow(ChatToolError);
  });
});

describe('planToolCall: 致命的な変更の禁止', () => {
  it('削除・口座・負債・秘匿情報に相当するツールは、名前を知っていても拒む', () => {
    for (const name of [
      'delete_transaction',
      'delete_genre',
      'delete_goal',
      'abandon_goal',
      'update_account_balance',
      'update_debt',
      'update_gmail_settings',
      'create_rule',
    ]) {
      expect(() => planToolCall(name, {}, CTX)).toThrow(ChatToolError);
    }
  });

  it('用意した書き込みツールはすべて isWriteToolName で認識され、削除を含まない', () => {
    for (const name of WRITE_TOOL_NAMES) {
      expect(isWriteToolName(name)).toBe(true);
      expect(name).not.toMatch(/delete|abandon|remove/);
    }
    expect(isWriteToolName('delete_transaction')).toBe(false);
  });
});

describe('parseAskUser', () => {
  it('質問と2〜4個の選択肢を返す', () => {
    const q = parseAskUser({
      question: 'どれくらい抑えますか?',
      options: [
        { label: '少しだけ', description: '5%' },
        { label: '思い切って', description: '20%' },
      ],
      multi_select: true,
    });
    expect(q).toEqual({
      question: 'どれくらい抑えますか?',
      options: [
        { label: '少しだけ', description: '5%' },
        { label: '思い切って', description: '20%' },
      ],
      multiSelect: true,
    });
  });

  it('選択肢が1個・5個、質問が空のときは拒む', () => {
    const opt = (label: string) => ({ label, description: '' });
    expect(() => parseAskUser({ question: 'q', options: [opt('a')] })).toThrow(ChatToolError);
    expect(() =>
      parseAskUser({ question: 'q', options: ['a', 'b', 'c', 'd', 'e'].map(opt) }),
    ).toThrow(ChatToolError);
    expect(() => parseAskUser({ question: '', options: [opt('a'), opt('b')] })).toThrow(
      ChatToolError,
    );
  });
});
