/**
 * 浪費傾向のタイプ(ADR-031)。固定6分類だけを許し、AIに新しい分類名を
 * 作らせない。ラベルもここに集約し、プロンプトと画面で表記がずれないようにする。
 */

export type SpendingPersonaType =
  'impulsive' | 'steady' | 'social' | 'goal_oriented' | 'frugal' | 'balanced';

export const SPENDING_PERSONA_TYPES: readonly SpendingPersonaType[] = [
  'impulsive',
  'steady',
  'social',
  'goal_oriented',
  'frugal',
  'balanced',
];

export const SPENDING_PERSONA_LABELS: Record<SpendingPersonaType, string> = {
  impulsive: '衝動買い型',
  steady: '堅実型',
  social: '交際費型',
  goal_oriented: '目標志向型',
  frugal: '倹約家型',
  balanced: 'メリハリ型',
};

/** 支出の「傾向」の説明であって、性格や体質そのものの断定ではない。 */
export const SPENDING_PERSONA_DESCRIPTIONS: Record<SpendingPersonaType, string> = {
  impulsive: '計画外の突発的な支出が多い傾向',
  steady: '支出が安定していて予算内に収まりやすい傾向',
  social: '人との付き合いに使う支出が多い傾向',
  goal_oriented: '貯蓄・投資・返済など明確な目的に向けて支出を絞れている傾向',
  frugal: '全体的に支出を抑える傾向が強い',
  balanced: '使うところと締めるところの差がはっきりしている傾向',
};
