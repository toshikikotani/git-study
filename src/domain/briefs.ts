/**
 * 毎朝配信(P3)の純粋ロジック(M5-1)。
 *
 * FR-31(情報のフィルタリング。情報商材・根拠不明な高収入案件・詐欺性・
 * アフィリエイト目的の除外、除外理由をログに残す)と、1トピックの選択。
 * コンテンツ源の決定(固定の定型文バンク)は ADR-020 を参照。
 */

import { daysBetween, type DateOnly } from '@/lib/date';

export type BriefExclusionReason =
  | 'info_product'
  | 'unverified_income'
  | 'suspected_scam'
  | 'affiliate_primary'
  | 'no_evidence'
  | 'expired'
  | 'duplicate'
  | 'off_topic'
  | 'other';

export type BriefTopicCandidate = {
  title: string;
  summary: string | null;
  sourceName: string | null;
};

export type ExcludedBriefTopic = {
  candidate: BriefTopicCandidate;
  reason: BriefExclusionReason;
  reasonDetail: string;
};

export type FilterBriefTopicsResult = {
  included: BriefTopicCandidate[];
  excluded: ExcludedBriefTopic[];
};

/**
 * FR-31 の除外ルール。本文(タイトル+要約)に危険シグナルが含まれていないか
 * を見る。固定の定型文バンク(ADR-020)は目視で安全と確認済みのため、
 * 通常はここで弾かれるものが無い想定だが、AI 生成・Web 検索に差し替わる
 * 将来(P2-2)に備えて実際に評価する。
 */
const RULES: readonly { reason: BriefExclusionReason; pattern: RegExp }[] = [
  { reason: 'info_product', pattern: /(情報商材|教材を購入|有料noteで公開)/ },
  {
    reason: 'unverified_income',
    pattern: /(必ず稼げ|誰でも[0-9０-９]+万円|月収[0-9０-９]+万円確約|権利収入|不労所得)/,
  },
  { reason: 'suspected_scam', pattern: /(絶対に儲かる|元本保証|今だけ特別に|怪しい業者)/ },
  {
    reason: 'affiliate_primary',
    pattern: /(このリンクから登録すると|紹介コード|アフィリエイト報酬)/,
  },
];

/**
 * 候補を FR-31 のルールで振り分ける。
 * どのルールにも当たらなければ採用、当たれば理由とともに除外側へ回す。
 */
export function filterBriefTopics(
  candidates: readonly BriefTopicCandidate[],
): FilterBriefTopicsResult {
  const included: BriefTopicCandidate[] = [];
  const excluded: ExcludedBriefTopic[] = [];

  for (const candidate of candidates) {
    const haystack = `${candidate.title} ${candidate.summary ?? ''}`;
    const matchedRule = RULES.find((rule) => rule.pattern.test(haystack));

    if (matchedRule) {
      excluded.push({
        candidate,
        reason: matchedRule.reason,
        reasonDetail: `パターンに一致: ${matchedRule.pattern.source}`,
      });
    } else {
      included.push(candidate);
    }
  }

  return { included, excluded };
}

/**
 * 当日の1件を固定バンクから決定的に選ぶ。
 * 同じ日に複数回呼んでも同じ結果になる(乱数を使わない)。
 */
export function pickDailyTopic<T>(bank: readonly T[], today: DateOnly): T {
  if (bank.length === 0) {
    throw new RangeError('bank が空です');
  }
  const daysSinceEpoch = daysBetween('1970-01-01', today);
  const index = ((daysSinceEpoch % bank.length) + bank.length) % bank.length;
  return bank[index]!;
}
