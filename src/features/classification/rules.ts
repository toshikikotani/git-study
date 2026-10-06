/**
 * リボ払い・キャッシング・分割払いの検知(FR-21)。
 *
 * ADR-057で、パターンによるカテゴリの自動判定(分類ルール)を廃止した。
 * ここに残るのはその廃止の対象外——支払方法の検知は「このパターンはこの
 * カテゴリ」という主観ではなく、見逃しが致命的な安全装置(ADR-010)で、
 * 固定3件を DB を介さず直接ここに持つ(以前からそうだった。
 * `DEFAULT_DETECTION_RULES` は DB に存在しない)。
 */

import type { PaymentMethod } from '@/features/import/adapters';
import { AppError } from '@/lib/errors';

export type RuleMatchType = 'keyword' | 'regex' | 'exact';

export type ClassificationRule = {
  id: string;
  name: string;
  matchType: RuleMatchType;
  pattern: string;
  setPaymentMethod: PaymentMethod;
};

/** 分類の対象。transactions の1行のうち、判定に使う部分だけ。 */
export type ClassifiableTransaction = {
  description: string;
  /** CSV から既に読めている支払方法。'unknown' 以外なら上書きしない。 */
  paymentMethod?: PaymentMethod | undefined;
};

export type Classification = {
  paymentMethod: PaymentMethod;
  /** 支払方法を設定したルールの id。 */
  appliedRuleIds: string[];
};

export class RuleError extends AppError {}

/** FR-21 の検知ルール(固定3件、DBには存在しない)。 */
export const DEFAULT_DETECTION_RULES: readonly ClassificationRule[] = [
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

/**
 * ルールを適用する。どれにも当たらなければ支払方法は元のままになる。
 */
export function applyRules(
  transaction: ClassifiableTransaction,
  rules: readonly ClassificationRule[] = DEFAULT_DETECTION_RULES,
): Classification {
  const result: Classification = {
    paymentMethod: transaction.paymentMethod ?? 'unknown',
    appliedRuleIds: [],
  };

  if (result.paymentMethod !== 'unknown') return result;

  for (const rule of rules) {
    if (!matches(transaction, rule)) continue;
    result.paymentMethod = rule.setPaymentMethod;
    result.appliedRuleIds.push(rule.id);
    break;
  }

  return result;
}

/** 1件のルールが明細に当たるかどうか。 */
export function matches(transaction: ClassifiableTransaction, rule: ClassificationRule): boolean {
  switch (rule.matchType) {
    case 'keyword':
      return normalize(transaction.description).includes(normalize(rule.pattern));
    case 'exact':
      return normalize(transaction.description) === normalize(rule.pattern);
    case 'regex':
      return compileRegex(rule.pattern, rule.name).test(transaction.description);
  }
}

/** 支払方法が「増やしてはいけない借入」かどうか(FR-21)。 */
export function isRiskyPaymentMethod(method: PaymentMethod): boolean {
  return method === 'revolving' || method === 'cashing' || method === 'installment';
}

/** 全角・半角と大小文字のゆれを吸収する。 */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '');
}

const regexCache = new Map<string, RegExp>();

function compileRegex(pattern: string, ruleName: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;

  try {
    // 明細の摘要は大小文字が揺れる。case-insensitive を既定にする。
    const compiled = new RegExp(pattern, 'i');
    regexCache.set(pattern, compiled);
    return compiled;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RuleError(`ルール「${ruleName}」の正規表現が不正です: ${detail}`);
  }
}
