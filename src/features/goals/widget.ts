/**
 * ロック画面・ウィジェット用。出すのは裁量の自由残と次の予定1件。
 * 今日あとは出さない。
 */

import type { GoalView } from './view';

export type WidgetSummary = {
  freeYen: number | null;
  pendingReceipts: number;
  nextScheduled: { label: string; date: string; amountYen: number } | null;
  captureUrl: string;
  label: string;
};

export function buildWidgetSummary(
  view: Pick<GoalView, 'active' | 'guidance' | 'scheduledItems'> | null,
  pendingReceipts: number,
): WidgetSummary {
  const active = view !== null && view.active && view.guidance !== null;
  const freeYen = active ? view.guidance.freeYen : null;
  const next = active ? (view.scheduledItems[0] ?? null) : null;
  const nextScheduled = next
    ? { label: next.label, date: next.date, amountYen: next.amountYen }
    : null;
  const parts: string[] = [];
  parts.push(freeYen === null ? '自由残なし' : `自由残 ${freeYen.toLocaleString('ja-JP')}円`);
  if (nextScheduled) parts.push(`次の予定 ${nextScheduled.label}`);
  if (pendingReceipts > 0) parts.push(`入力待ち ${pendingReceipts}件`);
  return {
    freeYen,
    pendingReceipts,
    nextScheduled,
    captureUrl: '/plan',
    label: parts.join(' ・ '),
  };
}
