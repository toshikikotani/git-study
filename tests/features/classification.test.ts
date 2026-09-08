import { describe, expect, it } from 'vitest';

import {
  RuleError,
  applyRules,
  buildLearnedRule,
  extractKeyword,
  isRiskyPaymentMethod,
  matches,
  type ClassifiableTransaction,
  type ClassificationRule,
} from '@/features/classification/rules';

const ACCOUNT = 'acc-1';

function tx(overrides: Partial<ClassifiableTransaction> = {}): ClassifiableTransaction {
  return {
    accountId: ACCOUNT,
    description: 'ローソン 渋谷',
    amountYen: -3500,
    ...overrides,
  };
}

function rule(overrides: Partial<ClassificationRule> = {}): ClassificationRule {
  return {
    id: 'r1',
    name: 'テスト',
    priority: 100,
    matchType: 'keyword',
    pattern: 'ローソン',
    categoryId: 'cat-living',
    isActive: true,
    ...overrides,
  };
}

/** seed_defaults が投入する FR-21 の検知ルール(docs/schema.sql §8)。 */
const DETECTION_RULES: ClassificationRule[] = [
  {
    id: 'd1',
    name: 'リボ払いの検知',
    priority: 1,
    matchType: 'regex',
    pattern: '(リボ|ﾘﾎﾞ|revolving|リボルビング)',
    setPaymentMethod: 'revolving',
    isActive: true,
  },
  {
    id: 'd2',
    name: 'キャッシングの検知',
    priority: 2,
    matchType: 'regex',
    pattern: '(キャッシング|ｷｬｯｼﾝｸﾞ|CASHING|カードローン|ATM借入)',
    setPaymentMethod: 'cashing',
    isActive: true,
  },
  {
    id: 'd3',
    name: '分割払いの検知',
    priority: 3,
    matchType: 'regex',
    pattern: '(分割|[0-9]+回払|ボーナス払)',
    setPaymentMethod: 'installment',
    isActive: true,
  },
];

describe('applyRules', () => {
  it('当たったルールのカテゴリを付ける', () => {
    const result = applyRules(tx(), [rule()]);
    expect(result.categoryId).toBe('cat-living');
    expect(result.matchedRuleId).toBe('r1');
    expect(result.appliedRuleIds).toEqual(['r1']);
  });

  it('どのルールにも当たらなければカテゴリは null(AI へ回す)', () => {
    const result = applyRules(tx({ description: '謎の店' }), [rule()]);
    expect(result.categoryId).toBeNull();
    expect(result.matchedRuleId).toBeNull();
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('priority 昇順で評価し、先に設定したカテゴリが勝つ', () => {
    const result = applyRules(tx(), [
      rule({ id: 'late', priority: 200, categoryId: 'cat-waste' }),
      rule({ id: 'early', priority: 10, categoryId: 'cat-living' }),
    ]);
    expect(result.categoryId).toBe('cat-living');
    expect(result.matchedRuleId).toBe('early');
  });

  it('無効なルールは評価しない', () => {
    const result = applyRules(tx(), [rule({ isActive: false })]);
    expect(result.categoryId).toBeNull();
  });

  it('支払方法だけを設定するルールはカテゴリ判定を邪魔しない(FR-21 と共存)', () => {
    const result = applyRules(tx({ description: 'ＡＭＡＺＯＮ リボ払い' }), [
      ...DETECTION_RULES,
      rule({ id: 'shop', priority: 100, pattern: 'AMAZON', categoryId: 'cat-waste' }),
    ]);
    expect(result.paymentMethod).toBe('revolving');
    expect(result.categoryId).toBe('cat-waste');
    expect(result.matchedRuleId).toBe('shop');
    expect(result.appliedRuleIds).toEqual(['d1', 'shop']);
  });

  it('CSV の支払区分から既に読めていれば、摘要のルールで上書きしない', () => {
    const result = applyRules(
      tx({ description: 'カードローン返済', paymentMethod: 'transfer' }),
      DETECTION_RULES,
    );
    expect(result.paymentMethod).toBe('transfer');
  });

  it('効果を適用しなかったルールは appliedRuleIds に入らない(hit_count を汚さない)', () => {
    const result = applyRules(tx(), [
      rule({ id: 'first', priority: 1, categoryId: 'cat-living' }),
      rule({ id: 'second', priority: 2, categoryId: 'cat-waste' }),
    ]);
    expect(result.appliedRuleIds).toEqual(['first']);
  });

  it('店名を設定するルールを適用する', () => {
    const result = applyRules(tx({ description: 'ローソン渋谷3丁目 0908' }), [
      rule({ pattern: 'ローソン', setMerchantName: 'ローソン', categoryId: undefined }),
    ]);
    expect(result.merchantName).toBe('ローソン');
  });
});

describe('FR-21 の検知ルール(seed_defaults と同じ定義)', () => {
  it.each([
    ['ＡＭＡＺＯＮ リボ払い', 'revolving'],
    ['ｼﾖｯﾋﾟﾝｸﾞ ﾘﾎﾞ', 'revolving'],
    ['ATM キャッシング', 'cashing'],
    ['ATM借入', 'cashing'],
    ['カードローン', 'cashing'],
    ['家電 3回払い', 'installment'],
    ['分割払い', 'installment'],
  ])('%s → %s', (description, expected) => {
    expect(applyRules(tx({ description }), DETECTION_RULES).paymentMethod).toBe(expected);
  });

  it('普通の買い物は unknown のまま(誤検知しない)', () => {
    expect(applyRules(tx({ description: 'ローソン 渋谷' }), DETECTION_RULES).paymentMethod).toBe(
      'unknown',
    );
  });

  it('リボはキャッシングより先に評価される(両方含む摘要)', () => {
    const result = applyRules(tx({ description: 'カードローン リボ払い' }), DETECTION_RULES);
    expect(result.paymentMethod).toBe('revolving');
  });
});

describe('matches', () => {
  it('keyword は部分一致', () => {
    expect(matches(tx(), rule({ matchType: 'keyword', pattern: 'ソン' }))).toBe(true);
  });

  it('keyword は全角・半角・大小文字のゆれを吸収する', () => {
    expect(
      matches(tx({ description: 'ＡＭＡＺＯＮ．ＣＯ．ＪＰ' }), rule({ pattern: 'amazon' })),
    ).toBe(true);
    expect(matches(tx({ description: 'ﾛｰｿﾝ' }), rule({ pattern: 'ローソン' }))).toBe(true);
  });

  it('exact は完全一致(空白の違いは無視)', () => {
    expect(matches(tx(), rule({ matchType: 'exact', pattern: 'ローソン渋谷' }))).toBe(true);
    expect(matches(tx(), rule({ matchType: 'exact', pattern: 'ローソン' }))).toBe(false);
  });

  it('regex は大小文字を区別しない', () => {
    expect(
      matches(tx({ description: 'Amazon.co.jp' }), rule({ matchType: 'regex', pattern: 'AMAZON' })),
    ).toBe(true);
  });

  it('merchant は正規化済み店名に対して完全一致', () => {
    const target = tx({ merchantName: 'ローソン' });
    expect(matches(target, rule({ matchType: 'merchant', pattern: 'ローソン' }))).toBe(true);
    expect(matches(tx(), rule({ matchType: 'merchant', pattern: 'ローソン' }))).toBe(false);
  });

  it('口座で適用範囲を絞れる', () => {
    expect(matches(tx(), rule({ accountId: 'other' }))).toBe(false);
    expect(matches(tx(), rule({ accountId: ACCOUNT }))).toBe(true);
  });

  it('金額の範囲は絶対値で比べる(支出の符号を意識させない)', () => {
    expect(matches(tx({ amountYen: -3500 }), rule({ minAmountYen: 3000 }))).toBe(true);
    expect(matches(tx({ amountYen: -2000 }), rule({ minAmountYen: 3000 }))).toBe(false);
    expect(matches(tx({ amountYen: -3500 }), rule({ maxAmountYen: 3000 }))).toBe(false);
  });

  it('amount_range は範囲だけで判定する', () => {
    const highSpend = rule({
      matchType: 'amount_range',
      pattern: undefined,
      minAmountYen: 30000,
      categoryId: 'cat-check',
    });
    expect(matches(tx({ amountYen: -50000, description: '何でもよい' }), highSpend)).toBe(true);
    expect(matches(tx({ amountYen: -1000 }), highSpend)).toBe(false);
  });

  it('amount_range に範囲が無ければエラー', () => {
    expect(() => matches(tx(), rule({ matchType: 'amount_range', pattern: undefined }))).toThrow(
      RuleError,
    );
  });

  it('パターンの無い keyword ルールはエラー', () => {
    expect(() => matches(tx(), rule({ pattern: undefined }))).toThrow(/パターンがありません/);
  });

  it('不正な正規表現はルール名を添えてエラーにする', () => {
    expect(() =>
      matches(tx(), rule({ matchType: 'regex', pattern: '(', name: '壊れたルール' })),
    ).toThrow(/壊れたルール/);
  });
});

describe('isRiskyPaymentMethod(FR-21)', () => {
  it.each([
    ['revolving', true],
    ['cashing', true],
    ['installment', true],
    ['one_time', false],
    ['debit', false],
    ['transfer', false],
    ['unknown', false],
  ] as const)('%s → %s', (method, expected) => {
    expect(isRiskyPaymentMethod(method)).toBe(expected);
  });
});

describe('extractKeyword', () => {
  it.each([
    ['ローソン渋谷3丁目 0908', 'ローソン渋谷3丁目'],
    ['AMAZON.CO.JP 12345678', 'AMAZON.CO.JP'],
    ['ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 001234', 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ'],
    ['スターバックス', 'スターバックス'],
  ])('%s → %s', (input, expected) => {
    expect(extractKeyword(input)).toBe(expected);
  });

  it('語の途中では切らない(「AMAZON.CO.」のような中途半端なキーワードにしない)', () => {
    expect(extractKeyword('AMAZON.CO.JP 12345678')).toBe('AMAZON.CO.JP');
  });

  it('空白で区切られない日本語の摘要もそのまま使う(数字は既に落ちている)', () => {
    expect(extractKeyword('あいうえおかきくけこさしすせそ')).toBe('あいうえおかきくけこさしすせそ');
  });

  it('異常に長い摘要は上限で切る', () => {
    expect(extractKeyword('あ'.repeat(100))).toHaveLength(24);
  });
});

describe('buildLearnedRule(FR-12 の学習)', () => {
  it('本人の修正から keyword ルールを作る', () => {
    const learned = buildLearnedRule({
      id: 'l1',
      description: 'ローソン渋谷3丁目 0908',
      categoryId: 'cat-living',
      fromTransactionId: 't1',
    });
    expect(learned.matchType).toBe('keyword');
    expect(learned.pattern).toBe('ローソン渋谷3丁目');
    expect(learned.categoryId).toBe('cat-living');
    expect(learned.isActive).toBe(true);
  });

  it('学習ルールは手書きルールより後に評価される', () => {
    const learned = buildLearnedRule({
      id: 'l1',
      description: 'ローソン',
      categoryId: 'cat-living',
      fromTransactionId: 't1',
    });
    expect(learned.priority).toBeGreaterThan(rule().priority);
  });

  it('作ったルールは同じ摘要の次の明細に当たる(AI を経由しなくなる)', () => {
    const learned = buildLearnedRule({
      id: 'l1',
      description: 'ローソン渋谷3丁目 0908',
      categoryId: 'cat-living',
      fromTransactionId: 't1',
    });
    const next = applyRules(tx({ description: 'ローソン渋谷3丁目 0915' }), [learned]);
    expect(next.categoryId).toBe('cat-living');
  });

  it('キーワードを取り出せない摘要は、手動ルールを促すエラーにする', () => {
    expect(() =>
      buildLearnedRule({
        id: 'l1',
        description: '12345678',
        categoryId: 'cat-living',
        fromTransactionId: 't1',
      }),
    ).toThrow(/手動でルールを作って/);
  });
});
