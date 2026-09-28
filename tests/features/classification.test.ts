import { describe, expect, it } from 'vitest';

import {
  RuleError,
  applyRules,
  isRiskyPaymentMethod,
  matches,
  type ClassifiableTransaction,
  type ClassificationRule,
} from '@/features/classification/rules';

function tx(overrides: Partial<ClassifiableTransaction> = {}): ClassifiableTransaction {
  return {
    description: 'ローソン 渋谷',
    ...overrides,
  };
}

/** seed_defaults が投入する FR-21 の検知ルール(docs/schema.sql §8)。 */
const DETECTION_RULES: ClassificationRule[] = [
  {
    id: 'd1',
    name: 'リボ払いの検知',
    matchType: 'regex',
    pattern: '(リボ|ﾘﾎﾞ|revolving|リボルビング)',
    setPaymentMethod: 'revolving',
  },
  {
    id: 'd2',
    name: 'キャッシングの検知',
    matchType: 'regex',
    pattern: '(キャッシング|ｷｬｯｼﾝｸﾞ|CASHING|カードローン|ATM借入)',
    setPaymentMethod: 'cashing',
  },
  {
    id: 'd3',
    name: '分割払いの検知',
    matchType: 'regex',
    pattern: '(分割|[0-9]+回払|ボーナス払)',
    setPaymentMethod: 'installment',
  },
];

describe('applyRules(FR-21の検知)', () => {
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
    const result = applyRules(tx({ description: 'ローソン 渋谷' }), DETECTION_RULES);
    expect(result.paymentMethod).toBe('unknown');
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('リボはキャッシングより先に評価される(両方含む摘要)', () => {
    const result = applyRules(tx({ description: 'カードローン リボ払い' }), DETECTION_RULES);
    expect(result.paymentMethod).toBe('revolving');
    expect(result.appliedRuleIds).toEqual(['d1']);
  });

  it('CSV の支払区分から既に読めていれば、摘要のルールで上書きしない', () => {
    const result = applyRules(
      tx({ description: 'カードローン返済', paymentMethod: 'transfer' }),
      DETECTION_RULES,
    );
    expect(result.paymentMethod).toBe('transfer');
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('既定はFR-21の検知ルール', () => {
    expect(applyRules(tx({ description: 'リボ払い' })).paymentMethod).toBe('revolving');
  });
});

describe('matches', () => {
  it('keyword は部分一致', () => {
    expect(
      matches(tx(), {
        id: 'r1',
        name: 'テスト',
        matchType: 'keyword',
        pattern: 'ソン',
        setPaymentMethod: 'revolving',
      }),
    ).toBe(true);
  });

  it('keyword は全角・半角・大小文字のゆれを吸収する', () => {
    const rule: ClassificationRule = {
      id: 'r1',
      name: 'テスト',
      matchType: 'keyword',
      pattern: 'amazon',
      setPaymentMethod: 'revolving',
    };
    expect(matches(tx({ description: 'ＡＭＡＺＯＮ．ＣＯ．ＪＰ' }), rule)).toBe(true);
    expect(matches(tx({ description: 'ﾛｰｿﾝ' }), { ...rule, pattern: 'ローソン' })).toBe(true);
  });

  it('exact は完全一致(空白の違いは無視)', () => {
    const base: ClassificationRule = {
      id: 'r1',
      name: 'テスト',
      matchType: 'exact',
      pattern: 'ローソン渋谷',
      setPaymentMethod: 'revolving',
    };
    expect(matches(tx(), base)).toBe(true);
    expect(matches(tx(), { ...base, pattern: 'ローソン' })).toBe(false);
  });

  it('regex は大小文字を区別しない', () => {
    expect(
      matches(tx({ description: 'Amazon.co.jp' }), {
        id: 'r1',
        name: 'テスト',
        matchType: 'regex',
        pattern: 'AMAZON',
        setPaymentMethod: 'revolving',
      }),
    ).toBe(true);
  });

  it('不正な正規表現はルール名を添えてエラーにする', () => {
    expect(() =>
      matches(tx(), {
        id: 'r1',
        name: '壊れたルール',
        matchType: 'regex',
        pattern: '(',
        setPaymentMethod: 'revolving',
      }),
    ).toThrow(RuleError);
    expect(() =>
      matches(tx(), {
        id: 'r1',
        name: '壊れたルール',
        matchType: 'regex',
        pattern: '(',
        setPaymentMethod: 'revolving',
      }),
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
