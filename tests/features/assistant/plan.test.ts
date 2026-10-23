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
import {
  recordChangeOf,
  recordFromEdit,
  type ProposedRecord,
} from '@/features/assistant/record-change';
import { screenLinkOf } from '@/features/assistant/screens';
import { ChatToolError } from '@/lib/chat-tools';
import { addDays, todayJst } from '@/lib/date';

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
  eveningCheckEnabled: true,
  eveningCheckAt: '21:00',
  receiptCheckLevel: 'normal',
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

  it('ホーム表示の切り替えはもう頼めない(ホームは気をつけたいカテゴリを自動で出す、ADR-117)', () => {
    expect(() =>
      planToolCall('set_genre_show_on_home', { genre_name: '外食', show_on_home: true }, CTX),
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

describe('AIで記録する add_transaction(ADR-103)', () => {
  const today = todayJst();

  it('支出の記録案:確認カードに日付・金額・カテゴリが出て、金額は負で記録する', () => {
    const { change, operation } = planToolCall(
      'add_transaction',
      { occurred_on: today, amount_yen: 500, store_name: 'セブン', genre_name: '食料品' },
      CTX,
    );
    expect(change.kind).toBe('created');
    expect(change.target).toBe('セブン');
    expect(change.detail).toContain('支出 500円 · 食料品');
    expect(operation).toMatchObject({ op: 'add_transaction', amountYen: -500, kind: 'normal' });
  });

  it('名前が無ければカテゴリ名、収入なら「収入」で記録する', () => {
    expect(
      planToolCall(
        'add_transaction',
        { occurred_on: today, amount_yen: 800, genre_name: '外食' },
        CTX,
      ).change.target,
    ).toBe('外食');
    const income = planToolCall(
      'add_transaction',
      { occurred_on: today, amount_yen: 250000, kind: 'income' },
      CTX,
    );
    expect(income.change.target).toBe('収入');
    expect(income.operation).toMatchObject({ amountYen: 250000 });
  });

  it('返金はカテゴリが要る。金額0・1年より前の日付・知らないカテゴリは受け付けない', () => {
    expect(() =>
      planToolCall('add_transaction', { occurred_on: today, amount_yen: 300, kind: 'refund' }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall('add_transaction', { occurred_on: today, amount_yen: 0 }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall('add_transaction', { occurred_on: addDays(today, -400), amount_yen: 100 }, CTX),
    ).toThrow(ChatToolError);
    expect(() =>
      planToolCall(
        'add_transaction',
        { occurred_on: today, amount_yen: 100, genre_name: '存在しない' },
        CTX,
      ),
    ).toThrow(ChatToolError);
  });

  it('先の日付は「予定」と書く', () => {
    const { change } = planToolCall(
      'add_transaction',
      { occurred_on: addDays(today, 7), amount_yen: 5000, genre_name: '外食' },
      CTX,
    );
    expect(change.detail).toContain('予定');
  });
});

describe('AIが出した記録の案を確認カードの上で直す(ADR-105)', () => {
  const today = todayJst();

  it('記録の案には中身(record)がつき、サーバーへ戻す入力はそろえた形になる', () => {
    const { change } = planToolCall(
      'add_transaction',
      { occurred_on: today, amount_yen: 500, store_name: ' セブン ', genre_name: '食料品' },
      CTX,
    );
    expect(change.record).toEqual({
      kind: 'expense',
      amountYen: 500,
      genreId: 'g-food',
      genreName: '食料品',
      date: today,
      name: 'セブン',
      memo: '',
    });
    expect(change.input).toEqual({
      occurred_on: today,
      amount_yen: 500,
      kind: 'expense',
      store_name: 'セブン',
      genre_name: '食料品',
    });
  });

  it('直した中身から作った案は、サーバーでもう一度確かめると同じ文言・同じ記録になる', () => {
    const edited: ProposedRecord = {
      kind: 'expense',
      amountYen: 1200,
      genreId: 'g-out',
      genreName: '外食',
      date: addDays(today, -1),
      name: 'ゲーセン',
      memo: '友だちと',
    };
    const local = recordChangeOf(edited, today);
    const { change, operation } = planToolCall('add_transaction', local.input, CTX);
    expect(change.target).toBe(local.target);
    expect(change.detail).toBe(local.detail);
    expect(local.target).toBe('ゲーセン');
    expect(local.detail).toContain('支出 1,200円 · 外食 · メモ「友だちと」');
    expect(operation).toMatchObject({
      op: 'add_transaction',
      amountYen: -1200,
      description: 'ゲーセン',
      genreId: 'g-out',
      memo: '友だちと',
    });
  });

  it('レシート名を空のまま直したら空に戻す(カテゴリを変えたら名前もついてくる)。収入はカテゴリを持たない', () => {
    const before: ProposedRecord = {
      kind: 'expense',
      amountYen: 800,
      genreId: 'g-food',
      genreName: '食料品',
      date: today,
      name: '',
      memo: '',
    };
    const toOut = recordFromEdit(
      before,
      { kind: 'expense', amountYen: 800, genreId: 'g-out', date: today, name: '外食', memo: '' },
      '外食',
    );
    expect(toOut).toMatchObject({ genreId: 'g-out', genreName: '外食', name: '' });
    expect(recordChangeOf(toOut, today).target).toBe('外食');

    const income = recordFromEdit(
      before,
      { kind: 'income', amountYen: 800, genreId: 'g-food', date: today, name: '収入', memo: '' },
      null,
    );
    expect(income).toMatchObject({ kind: 'income', genreId: null, genreName: null, name: '' });
    expect(recordChangeOf(income, today).input).not.toHaveProperty('genre_name');
  });

  it('選べるタイルに無いカテゴリのまま変えなかったときは、前のカテゴリを残す', () => {
    const before: ProposedRecord = {
      kind: 'expense',
      amountYen: 300,
      genreId: 'g-food',
      genreName: '食料品',
      date: today,
      name: 'パン',
      memo: '',
    };
    expect(
      recordFromEdit(
        before,
        { kind: 'expense', amountYen: 350, genreId: 'g-food', date: today, name: 'パン', memo: '' },
        null,
      ),
    ).toMatchObject({ amountYen: 350, genreId: 'g-food', genreName: '食料品' });
  });
});

describe('AIが出す画面へのボタン show_screen(ADR-103)', () => {
  it('決まった画面だけをボタンにする(知らない名前は出さない)', () => {
    expect(screenLinkOf('spending')).toEqual({ href: '/spending', label: '明細' });
    expect(screenLinkOf('month_review')?.href).toBe('/reports/month');
    expect(screenLinkOf('https://example.com')).toBeNull();
    expect(screenLinkOf(undefined)).toBeNull();
  });
});
