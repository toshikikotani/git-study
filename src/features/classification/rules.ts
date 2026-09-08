/**
 * ルールベースの明細分類(FR-12, FR-13)。
 *
 * ── なぜ AI より先にここを通すのか ──────────────────────────────
 * 1. コスト:ルールが増えるほど AI 呼び出しが減り、ランニングコストが
 *    逓減する(NFR-01)。本人が分類を直すほどシステムが軽くなる。
 * 2. 確実性:リボ・キャッシング・分割の検知(FR-21)は見逃しが致命的なので、
 *    確率的な出力に依存させない(ADR-010)。ここで決定的に判定する。
 * 3. 構造:ルールは本人が読んで直せる。AI の判断は直せない(設計原則1)。
 *
 * ── 適用の考え方 ────────────────────────────────────────────
 * ルールは priority 昇順に評価し、各フィールドは **最初に設定した
 * ルールが勝つ**。これにより、支払方法だけを設定する検知ルール(priority 1〜3)と
 * カテゴリを設定する分類ルールが衝突せず共存できる。
 */

import type { PaymentMethod } from '@/features/import/adapters';

export type RuleMatchType = 'keyword' | 'regex' | 'exact' | 'amount_range' | 'merchant';

/** classification_rules テーブルの1行に対応する。 */
export type ClassificationRule = {
  id: string;
  name: string;
  priority: number;
  matchType: RuleMatchType;
  /** amount_range 以外では必須。 */
  pattern?: string | undefined;

  /** 適用範囲の絞り込み。未指定なら全口座。 */
  accountId?: string | undefined;
  minAmountYen?: number | undefined;
  maxAmountYen?: number | undefined;

  /** 付与する値。少なくとも1つは設定されている必要がある。 */
  categoryId?: string | undefined;
  setPaymentMethod?: PaymentMethod | undefined;
  setMerchantName?: string | undefined;

  isActive: boolean;
};

/** 分類の対象。transactions の1行のうち、判定に使う部分だけ。 */
export type ClassifiableTransaction = {
  accountId: string;
  description: string;
  merchantName?: string | undefined;
  /** 支出が負、収入が正(ADR-008)。 */
  amountYen: number;
  /** CSV から既に読めている支払方法。'unknown' 以外なら上書きしない。 */
  paymentMethod?: PaymentMethod | undefined;
};

export type Classification = {
  categoryId: string | null;
  /** カテゴリを決めたルール。transactions.matched_rule_id に入る。 */
  matchedRuleId: string | null;
  paymentMethod: PaymentMethod;
  merchantName: string | null;
  /** 何らかの効果を適用したルールの id。hit_count の更新に使う。 */
  appliedRuleIds: string[];
};

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/**
 * FR-21 の検知ルール(seed_defaults が投入するものと同じ定義。docs/schema.sql §8)。
 *
 * CSV 取り込み・メール貼り付けのどちらも、Supabase 未接続のいま DB からは
 * 読めないため、ここに1箇所だけ持つ。取り込み経路が増えても、ここを
 * 直せば全員に効く(以前は取り込み画面ごとに複製されていた)。
 */
export const DEFAULT_DETECTION_RULES: readonly ClassificationRule[] = [
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

/**
 * ルールを適用する。
 *
 * どのルールにも当たらなければ categoryId は null のまま返る。
 * 呼び出し側はそれを AI 分類(M2-4)へ回す。
 */
export function applyRules(
  transaction: ClassifiableTransaction,
  rules: readonly ClassificationRule[],
): Classification {
  const result: Classification = {
    categoryId: null,
    matchedRuleId: null,
    // CSV の支払区分列から既に読めていれば、それを初期値として尊重する。
    // 摘要にも支払区分にも現れる形式で、両方の経路が食い違うのを防ぐ。
    paymentMethod: transaction.paymentMethod ?? 'unknown',
    merchantName: transaction.merchantName ?? null,
    appliedRuleIds: [],
  };

  const ordered = [...rules]
    .filter((rule) => rule.isActive)
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const rule of ordered) {
    if (!matches(transaction, rule)) continue;

    let applied = false;

    if (result.categoryId === null && rule.categoryId !== undefined) {
      result.categoryId = rule.categoryId;
      result.matchedRuleId = rule.id;
      applied = true;
    }
    if (result.paymentMethod === 'unknown' && rule.setPaymentMethod !== undefined) {
      result.paymentMethod = rule.setPaymentMethod;
      applied = true;
    }
    if (result.merchantName === null && rule.setMerchantName !== undefined) {
      result.merchantName = rule.setMerchantName;
      applied = true;
    }

    if (applied) {
      result.appliedRuleIds.push(rule.id);
    }
  }

  return result;
}

/** 1件のルールが明細に当たるかどうか。 */
export function matches(transaction: ClassifiableTransaction, rule: ClassificationRule): boolean {
  if (rule.accountId !== undefined && rule.accountId !== transaction.accountId) {
    return false;
  }

  // 金額の範囲は絶対値で比べる。「3,000円以上の支出」を書くたびに
  // 符号を意識させるのは、本人がルールを整えるうえで摩擦になる(設計原則1)。
  const absAmount = Math.abs(transaction.amountYen);
  if (rule.minAmountYen !== undefined && absAmount < rule.minAmountYen) return false;
  if (rule.maxAmountYen !== undefined && absAmount > rule.maxAmountYen) return false;

  if (rule.matchType === 'amount_range') {
    // 範囲だけで判定するルール。ここまで来たら範囲に収まっている。
    if (rule.minAmountYen === undefined && rule.maxAmountYen === undefined) {
      throw new RuleError(`amount_range のルールに範囲がありません: ${rule.name}`);
    }
    return true;
  }

  const pattern = rule.pattern;
  if (pattern === undefined || pattern === '') {
    throw new RuleError(`${rule.matchType} のルールにパターンがありません: ${rule.name}`);
  }

  const haystack =
    rule.matchType === 'merchant' ? (transaction.merchantName ?? '') : transaction.description;

  switch (rule.matchType) {
    case 'keyword':
      return normalize(haystack).includes(normalize(pattern));
    case 'exact':
    case 'merchant':
      return normalize(haystack) === normalize(pattern);
    case 'regex':
      return compileRegex(pattern, rule.name).test(haystack);
  }
}

/** 支払方法が「増やしてはいけない借入」かどうか(FR-21)。 */
export function isRiskyPaymentMethod(method: PaymentMethod): boolean {
  return method === 'revolving' || method === 'cashing' || method === 'installment';
}

/**
 * 本人の修正から学習ルールを作る(FR-12)。
 *
 * 摘要そのものを exact で覚えると、日付や店舗番号が混じる摘要では二度と当たらない。
 * 逆に短すぎるキーワードは無関係な明細まで巻き込む。ここでは摘要から
 * 「変動しにくい部分」を切り出してキーワードにする。
 */
export function buildLearnedRule(params: {
  id: string;
  description: string;
  categoryId: string;
  accountId?: string | undefined;
  fromTransactionId: string;
  priority?: number | undefined;
}): ClassificationRule {
  const keyword = extractKeyword(params.description);
  if (keyword.length < 2) {
    throw new RuleError(
      `摘要 ${JSON.stringify(params.description)} からルールを作れません。手動でルールを作ってください。`,
    );
  }

  return {
    id: params.id,
    name: `学習: ${keyword}`,
    // 学習ルールは手書きルールより後に評価する。本人が明示的に書いたものを優先する。
    priority: params.priority ?? 500,
    matchType: 'keyword',
    pattern: keyword,
    accountId: params.accountId,
    categoryId: params.categoryId,
    isActive: true,
  };
}

/** キーワードの上限。異常に長い摘要への保険。 */
const MAX_KEYWORD_LENGTH = 24;

/**
 * 摘要から変動しにくい部分を取り出す。
 *
 * 明細の摘要には日付・伝票番号・店舗コードが混じる:
 *   「ローソン渋谷3丁目 0908」→「ローソン渋谷3丁目」
 *   「AMAZON.CO.JP 12345678」 →「AMAZON.CO.JP」
 */
export function extractKeyword(description: string): string {
  const cleaned = description
    // 連続する数字(日付・伝票番号・店舗コード)を削る
    .replace(/[0-9０-９]{3,}/g, ' ')
    // 記号の連続を空白に寄せる
    .replace(/[*#/\\|()[\]{}<>]+/g, ' ')
    .replace(/[\s　]+/g, ' ')
    .trim();

  // 最初の語を代表にする。語の途中で切ると「AMAZON.CO.」のような中途半端な
  // キーワードになるため、丸ごと残す。数字は既に落としてあるので、
  // 末尾に日付や伝票番号が付く次の明細にもこのまま当たる。
  const firstToken = cleaned.split(' ').find((token) => token !== '') ?? cleaned;
  return firstToken.slice(0, MAX_KEYWORD_LENGTH).trim();
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
