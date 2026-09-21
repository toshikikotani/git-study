/**
 * AI月次レポート(本人発案「AI関連もっと増やしたい。もっと画期的な機能ない?」、
 * ADR-031)の浪費傾向タイプ。固定6分類のみで、AIに自由記述させない——
 * 「一般的にこういうタイプ」という要望に応えつつ、根拠の無い性格診断・
 * 医学的な断定(ホルモン等、本人の明示的な要望で除外)に踏み込ませないための
 * 歯止め。ラベル・説明はここに集約し、AIプロンプト側(features/ai-report/
 * monthly-report-ai.ts)と画面側(app/(app)/reports/ai/)で表記がずれないようにする。
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
