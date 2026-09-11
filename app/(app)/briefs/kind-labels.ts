import type { BriefExclusionReasonValue, BriefItemKind } from '@/features/briefs/store';

export const BRIEF_ITEM_KIND_LABELS: Record<BriefItemKind, string> = {
  headline: '見出し',
  income_tip: '収入増のヒント',
  market: '市場の話題',
  campaign: 'キャンペーン',
};

/** FR-31 の除外理由。docs/schema.sql の brief_exclusion_reason に対応する。 */
export const BRIEF_EXCLUSION_REASON_LABELS: Record<BriefExclusionReasonValue, string> = {
  info_product: '情報商材',
  unverified_income: '根拠不明な高収入案件',
  suspected_scam: '詐欺性が疑われる',
  affiliate_primary: 'アフィリエイト目的が主',
  no_evidence: '一次情報が確認できない',
  expired: '期限切れ',
  duplicate: '重複',
  off_topic: '話題がずれている',
  other: 'その他',
};
