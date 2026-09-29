/**
 * ウィジェット・ショートカット用の要約(「今日あと○円」と入力待ちの件数)。
 * 数字は目標カードと同じ planGuidance の値(todayAllowanceYen)で、ここで再計算しない。
 */

import type { GoalView } from './view';

export type WidgetSummary = {
  /** 今日あと使える額。目標が無い/期間外なら null。 */
  todayAllowanceYen: number | null;
  /** 入力待ちのレシートの件数(集計に入っていないもの)。 */
  pendingReceipts: number;
  /** 撮影を直接開く URL(ショートカット・ウィジェットのタップ先)。 */
  captureUrl: string;
  /** 表示用の1行(例:「今日あと 2,300円」)。 */
  label: string;
};

export function buildWidgetSummary(
  view: Pick<GoalView, 'active' | 'guidance'> | null,
  pendingReceipts: number,
): WidgetSummary {
  const allowance =
    view !== null && view.active && view.guidance !== null ? view.guidance.todayAllowanceYen : null;
  const money = allowance === null ? null : `${allowance.toLocaleString('ja-JP')}円`;
  const parts = [money === null ? '目標なし' : `今日あと ${money}`];
  if (pendingReceipts > 0) parts.push(`入力待ち ${pendingReceipts}件`);
  return {
    todayAllowanceYen: allowance,
    pendingReceipts,
    captureUrl: '/spending?capture=1',
    label: parts.join(' ・ '),
  };
}
