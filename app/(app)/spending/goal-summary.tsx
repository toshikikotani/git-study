import {
  STATE_COLOR,
  STATE_ICON,
  STATE_LABEL,
  STATE_TRACK,
  budgetState,
} from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { formatRemainingDays } from '@/domain/period';
import type { GoalView } from '@/features/goals/view';
import { formatDateJa } from '@/lib/date';

/**
 * 家計簿のサマリーに出す、目標期間のスライド(期間・残り日数・使った額/予算・今日使える額)。
 * 数字は目標画面と同じ GoalView(特別費・予定を除いたペース)。横スワイプで月表示に切り替える。
 */
export function GoalSummary({ view, today }: { view: GoalView; today: string }) {
  const g = view.guidance;
  const state = budgetState({
    spentYen: g.spentYen,
    budgetYen: g.targetYen,
    idealYen: g.expectedByTodayYen,
  });
  const ratio = g.targetYen > 0 ? Math.min(g.spentYen / g.targetYen, 1) : 0;
  const ideal = g.targetYen > 0 ? Math.min(g.expectedByTodayYen / g.targetYen, 1) : null;

  return (
    <section
      aria-label="目標期間のサマリー"
      className="rounded-3xl p-6"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        目標期間 {formatDateJa(view.range.from)} 〜 {formatDateJa(view.range.to)}
        <span className="ml-1.5 font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {formatRemainingDays(view.range.from, view.range.to, today)}
        </span>
      </p>
      <p
        className="tabular mt-1 text-4xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink)' }}
      >
        {formatYen(g.spentYen, { sign: 'never' })}
        <span className="ml-1 text-base font-normal" style={{ color: 'var(--ink-muted)' }}>
          / {formatYen(g.targetYen, { sign: 'never' })}
        </span>
      </p>
      <div
        aria-hidden
        className="relative mt-3 h-2.5 overflow-hidden rounded-full"
        style={{ background: STATE_TRACK[state] }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${ratio * 100}%`, background: STATE_COLOR[state] }}
        />
        {ideal !== null ? (
          <span
            className="absolute inset-y-0 w-0.5"
            style={{ left: `calc(${ideal * 100}% - 1px)`, background: 'var(--ink)', opacity: 0.55 }}
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs font-semibold" style={{ color: STATE_COLOR[state] }}>
        <span aria-hidden>{STATE_ICON[state]} </span>
        {STATE_LABEL[state]}
        <span className="ml-1 font-normal" style={{ color: 'var(--ink-muted)' }}>
          (縦線=今日時点の理想ペース)
        </span>
      </p>

      {g.todayAllowanceYen !== null ? (
        <p className="tabular mt-3 text-sm" style={{ color: 'var(--ink)' }}>
          今日使える額{' '}
          <span className="font-semibold">{formatYen(g.todayAllowanceYen, { sign: 'never' })}</span>
          {g.dailyAllowanceYen !== null ? (
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {' '}
              (1日の目安 {formatYen(g.dailyAllowanceYen, { sign: 'never' })})
            </span>
          ) : null}
        </p>
      ) : null}
      {g.specialYen > 0 || g.scheduledYen > 0 ? (
        <p className="tabular mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {g.specialYen > 0 ? `特別費 ${formatYen(g.specialYen)}(ペースに含めない)` : ''}
          {g.specialYen > 0 && g.scheduledYen > 0 ? ' ・ ' : ''}
          {g.scheduledYen > 0 ? `予定 ${formatYen(g.scheduledYen)}` : ''}
        </p>
      ) : null}
    </section>
  );
}
