/**
 * 目標カードに出す内容(表示モデル)。主役の指標を「今日あと○円」の1つに絞り、
 * 1日の目安・理想ペースとの差・予算・予定・実績は、タップで展開する内訳へ移す。
 *
 * 約束:
 *   - 同じ数値を、別の意味で二度並べない(重なった内訳は落とす。優先度は上から)
 *   - 理想ペースとの差は、符号ではなく言葉で表す(「理想より5,614円少ない」)
 *   - 状態バッジは注意・超過のときだけ(余裕のときは出さない)
 */

import { formatYen } from '@/domain/money';
import { formatRemainingDays } from '@/domain/period';
import { paceDiffWords, type GuidanceStatus } from '@/domain/spending-plan';
import type { GoalView } from './view';

export type GoalCardDetail = {
  key: 'daily' | 'pace' | 'budget' | 'scheduled' | 'spent';
  label: string;
  /** 表示する文字列(金額を含む)。 */
  text: string;
  /** 重複判定に使う金額。 */
  amountYen: number;
};

export type GoalCardModel = {
  periodLabel: string;
  remainingLabel: string;
  primary: { label: string; amountYen: number | null; note: string | null };
  badge: { state: 'caution' | 'over'; label: string } | null;
  summary: string;
  details: GoalCardDetail[];
  scheduled: { count: number; totalYen: number; items: GoalView['scheduledItems'] } | null;
  uncategorized: { yen: number } | null;
  pending: { count: number } | null;
};

const SUMMARY: Record<GuidanceStatus, string> = {
  on_track: '順調です',
  watch: '目標に近づいています',
  over_pace: 'ペースが速めです',
  over: '目標を超えています',
  ended: '目標内で終えました',
  not_started: 'これから始まります',
  no_budget: '目標額が決まっていません',
  reserved: '予定で確保済みです',
};

export function buildGoalCard(
  view: GoalView,
  today: string,
  options: { pendingCount?: number } = {},
): GoalCardModel {
  const g = view.guidance;
  const { from, to } = view.range;

  const primaryYen = g.todayAllowanceYen;
  const primary: GoalCardModel['primary'] = {
    label: '今日あと',
    amountYen: primaryYen,
    note:
      primaryYen === 0 && g.todaySpentYen > 0
        ? '今日の目安に達しました(明日からまた使えます)'
        : null,
  };

  const badge: GoalCardModel['badge'] =
    g.status === 'over' || (g.status === 'over_pace' && g.freeYen < 0)
      ? { state: 'over', label: '超過' }
      : g.status === 'watch' || g.status === 'over_pace'
        ? { state: 'caution', label: '注意' }
        : null;

  // 内訳。上にあるものほど優先し、すでに表示した金額と同じ値は落とす。
  const candidates: GoalCardDetail[] = [];
  if (g.dailyAllowanceYen !== null) {
    candidates.push({
      key: 'daily',
      label: '1日の目安',
      text: `${formatYen(g.dailyAllowanceYen, { sign: 'never' })}(予定を引いた予算 ÷ 残り${g.remainingDays}日)`,
      amountYen: g.dailyAllowanceYen,
    });
  }
  if (g.dailyAllowanceYen !== null) {
    candidates.push({
      key: 'pace',
      label: '理想ペースとの差',
      text: paceDiffWords(g.paceDiffYen),
      amountYen: Math.abs(g.paceDiffYen),
    });
  }
  candidates.push({
    key: 'budget',
    label: '総予算',
    text: formatYen(g.targetYen, { sign: 'never' }),
    amountYen: g.targetYen,
  });
  if (g.scheduledYen > 0) {
    candidates.push({
      key: 'scheduled',
      label: '予定(予算から確保)',
      text: formatYen(g.scheduledYen, { sign: 'never' }),
      amountYen: g.scheduledYen,
    });
  }
  candidates.push({
    key: 'spent',
    label: '使った額',
    text: formatYen(g.spentYen, { sign: 'never' }),
    amountYen: g.spentYen,
  });

  const seen = new Set<number>();
  if (primaryYen !== null && primaryYen > 0) seen.add(primaryYen);
  const details: GoalCardDetail[] = [];
  for (const d of candidates) {
    // 0円と、差が0(理想どおり)は重複とみなさない。
    if (d.amountYen > 0 && seen.has(d.amountYen)) continue;
    if (d.amountYen > 0) seen.add(d.amountYen);
    details.push(d);
  }

  return {
    periodLabel: `${from.slice(5).replace('-', '/')}〜${to.slice(5).replace('-', '/')}`,
    remainingLabel: formatRemainingDays(from, to, today),
    primary,
    badge,
    summary: SUMMARY[g.status],
    details,
    scheduled:
      view.scheduledItems.length > 0
        ? {
            count: view.scheduledItems.length,
            totalYen: view.scheduledItems.reduce((a, i) => a + i.amountYen, 0),
            items: view.scheduledItems,
          }
        : null,
    uncategorized: view.uncategorizedYen > 0 ? { yen: view.uncategorizedYen } : null,
    pending:
      options.pendingCount && options.pendingCount > 0 ? { count: options.pendingCount } : null,
  };
}
