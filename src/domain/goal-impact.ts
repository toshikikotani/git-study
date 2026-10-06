/**
 * レシートを保存したときの、目標への影響(保存前 → 保存後の残り予算)と、
 * 保存後のひと言(叱らずに、超過額と明日からの1日の目安を示す)。
 * 「目標の予算に含める / 特別費として別枠」を選ばせる条件もここで決める。
 */

import { budgetState, type BudgetState } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { entryStatus } from '@/domain/ledger';
import { addDays, type DateOnly } from '@/lib/date';
import { remainingDays } from '@/domain/period';

export type GoalSnapshot = {
  range: { from: DateOnly; to: DateOnly };
  /** 期間内の予定の支出の合計。明日からの1日の目安は、これを予算から差し引いて出す。 */
  scheduledYen?: number;
  genres: readonly {
    genreId: string;
    genreName: string;
    targetYen: number;
    /** 特別費・予定を除いた今の実績。 */
    spentYen: number;
  }[];
};

/** 保存する取引が、ジャンルごとに動かす額(正の円)。 */
export type ImpactDelta = { genreId: string | null; amountYen: number };

export type ImpactRow = {
  genreId: string;
  genreName: string;
  targetYen: number;
  beforeSpentYen: number;
  afterSpentYen: number;
  beforeRemainingYen: number;
  afterRemainingYen: number;
  /** 保存後の状態。 */
  state: BudgetState;
};

export type ImpactReason = 'included' | 'special' | 'scheduled' | 'outside_period' | 'no_target';

export type GoalImpact = {
  /** 目標のペースに数えるか。 */
  counts: boolean;
  reason: ImpactReason;
  rows: ImpactRow[];
};

export function goalImpact(
  goal: GoalSnapshot,
  tx: {
    occurredOn: DateOnly;
    today: DateOnly;
    kind: 'normal' | 'special';
    deltas: readonly ImpactDelta[];
  },
): GoalImpact {
  const byGenre = new Map<string, number>();
  for (const d of tx.deltas) {
    if (d.genreId !== null) byGenre.set(d.genreId, (byGenre.get(d.genreId) ?? 0) + d.amountYen);
  }
  const affected = goal.genres.filter((g) => g.targetYen > 0 && byGenre.has(g.genreId));

  let reason: ImpactReason = 'included';
  if (tx.kind === 'special') reason = 'special';
  else if (entryStatus(tx.occurredOn, tx.today) === 'scheduled') reason = 'scheduled';
  else if (tx.occurredOn < goal.range.from || tx.occurredOn > goal.range.to)
    reason = 'outside_period';
  else if (affected.length === 0) reason = 'no_target';

  const counts = reason === 'included';
  const rows: ImpactRow[] = affected.map((g) => {
    const delta = counts ? (byGenre.get(g.genreId) ?? 0) : 0;
    const after = g.spentYen + delta;
    return {
      genreId: g.genreId,
      genreName: g.genreName,
      targetYen: g.targetYen,
      beforeSpentYen: g.spentYen,
      afterSpentYen: after,
      beforeRemainingYen: g.targetYen - g.spentYen,
      afterRemainingYen: g.targetYen - after,
      state: budgetState({ spentYen: after, budgetYen: g.targetYen }),
    };
  });
  return { counts, reason, rows };
}

/** 高額とみなす、そのジャンルの予算に対する割合。 */
export const LARGE_SHARE = 0.5;

/**
 * 「目標の予算に含める / 特別費として別枠」を選ばせる必要があるか。
 * 未来日、または、そのジャンルの予算の50%以上になる取引。
 */
export function needsKindChoice(
  goal: GoalSnapshot | null,
  tx: { occurredOn: DateOnly; today: DateOnly; deltas: readonly ImpactDelta[] },
): { needed: boolean; reason: 'scheduled' | 'large' | null } {
  if (goal === null) return { needed: false, reason: null };
  if (entryStatus(tx.occurredOn, tx.today) === 'scheduled')
    return { needed: true, reason: 'scheduled' };
  const byGenre = new Map<string, number>();
  for (const d of tx.deltas) {
    if (d.genreId !== null) byGenre.set(d.genreId, (byGenre.get(d.genreId) ?? 0) + d.amountYen);
  }
  const large = goal.genres.some(
    (g) => g.targetYen > 0 && (byGenre.get(g.genreId) ?? 0) >= g.targetYen * LARGE_SHARE,
  );
  return large ? { needed: true, reason: 'large' } : { needed: false, reason: null };
}

const REASON_TEXT: Record<Exclude<ImpactReason, 'included'>, string> = {
  special: '特別費として別枠にしたので、目標のペースには含めません',
  scheduled: '今日より先の予定なので、目標のペースには含めません',
  outside_period: '目標の期間の外なので、目標には含めません',
  no_target: '目標のあるジャンルではないので、目標には含めません',
};

/**
 * 保存後のひと言。叱る表現は使わない。
 *   - 目標に含めない取引:その理由
 *   - 目安(そのジャンルの目標)を超えた:超過額と、明日からの1日の目安を1文で
 *   - それ以外:影響のあったジャンルの残り
 */
export function goalToastMessage(input: {
  label: string;
  impact: GoalImpact;
  goal: GoalSnapshot;
  today: DateOnly;
}): string {
  const { label, impact, goal, today } = input;
  const saved = `${label}を保存しました。`;
  if (!impact.counts) {
    return impact.reason === 'included' ? saved : `${saved}${REASON_TEXT[impact.reason]}。`;
  }
  const over = impact.rows
    .filter((r) => r.afterRemainingYen < 0)
    .sort((a, b) => a.afterRemainingYen - b.afterRemainingYen)[0];
  if (over) {
    const tomorrow = addDays(today, 1);
    const daysAfterToday = remainingDays(goal.range.from, goal.range.to, tomorrow);
    const overYen = formatYen(-over.afterRemainingYen, { sign: 'never' });
    if (daysAfterToday <= 0) return `${saved}${over.genreName}が目安を${overYen}超えました。`;
    // 明日からの1日の目安:全ジャンルの残りを、明日以降の日数で割る(保存後の実績で)。
    const afterByGenre = new Map(impact.rows.map((r) => [r.genreId, r.afterSpentYen]));
    const targetYen = goal.genres.reduce((a, g) => a + g.targetYen, 0);
    const spentYen = goal.genres.reduce(
      (a, g) => a + (g.targetYen > 0 ? (afterByGenre.get(g.genreId) ?? g.spentYen) : 0),
      0,
    );
    const perDay = Math.max(
      Math.floor((targetYen - (goal.scheduledYen ?? 0) - spentYen) / daysAfterToday),
      0,
    );
    return `${saved}${over.genreName}が目安を${overYen}超えました。明日からは1日${formatYen(perDay, { sign: 'never' })}が目安です。`;
  }
  const first = impact.rows[0];
  return first
    ? `${saved}${first.genreName}の残りは${formatYen(first.afterRemainingYen, { sign: 'never' })}です。`
    : saved;
}
