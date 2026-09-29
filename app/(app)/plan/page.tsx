import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { STATE_COLOR } from '@/domain/budget-state';
import { formatYen } from '@/domain/money';
import { formatRemainingDays } from '@/domain/period';
import { planPeriodDays, type GuidanceStatus } from '@/domain/spending-plan';
import { loadGoalView } from '@/features/goals/loader';
import { getAppSettings } from '@/features/settings/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { DeletePlanButton } from './delete-plan-button';
import { EditPlanSection } from './edit-plan-section';
import { PlanBuilder } from './plan-builder';
import { ReviewCard } from './review-card';

/**
 * 目標(本人発案「カレンダーの範囲を選択して、そこまでの支出目標を立てたい。
 * AIと相談してカテゴリごとに目標設定する…徐々に改善をかけれるような設定で」、ADR-058)。
 *
 * 上に直近の目標の進み具合、下に新しい目標を立てる画面。数字は家計簿と同じ集計
 * (特別費・予定はペースに含めず、別の行で見せる)。目標期間が終わったら振り返りを出し、
 * 「この結果で次の目標を作る」で次の目標へつなぐ。
 */

export const dynamic = 'force-dynamic';
// 「AIに目標案を作ってもらう」の Server Action はこのページの上限時間で動く。
export const maxDuration = 60;

const STATUS_LABEL: Record<GuidanceStatus, string> = {
  not_started: 'これから',
  on_track: '順調',
  watch: 'もう少しで目標',
  over_pace: 'ペースが速め',
  over: '目標を超えています',
  ended: '達成',
  no_budget: '予算なし',
};

const STATUS_COLOR: Record<GuidanceStatus, string> = {
  not_started: 'var(--state-none)',
  on_track: 'var(--state-ok)',
  watch: 'var(--state-caution)',
  over_pace: 'var(--state-caution)',
  over: STATE_COLOR.over,
  ended: 'var(--state-ok)',
  no_budget: 'var(--state-none)',
};

export default async function PlanPage() {
  const today = todayJst();
  const [loaded, settings] = await withMinDuration(Promise.all([loadGoalView(), getAppSettings()]));
  const plan = loaded?.plan ?? null;
  const view = loaded?.view ?? null;
  const guidance = view?.guidance ?? null;

  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          目標
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          期間を決めて、ジャンルごとの支出目標を少しずつ改善していく
        </p>
      </header>

      {view?.review && plan ? <ReviewCard planId={plan.id} review={view.review} /> : null}

      {/* 行動指針:要約1文と、要対応ジャンルの上位2件だけ(下の一覧と重複させない) */}
      {guidance !== null && view !== null && !view.ended ? (
        <section
          aria-label="行動指針"
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
              行動指針
            </p>
            <span
              className="text-xs font-semibold"
              style={{ color: STATUS_COLOR[guidance.status] }}
            >
              {STATUS_LABEL[guidance.status]}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
            {guidance.headline}
          </p>
          {guidance.actions.length > 0 ? (
            <ul
              className="mt-3 space-y-1.5 border-t pt-3"
              style={{ borderColor: 'var(--hairline)' }}
            >
              {guidance.actions.map((action) => (
                <li
                  key={action}
                  className="text-xs leading-relaxed"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  ・{action}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {plan !== null && view !== null && guidance !== null ? (
        <section
          aria-label="今の目標"
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            {view.ended ? '終わった目標' : '今の目標'}
          </p>
          <p className="mt-0.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {formatDateJa(plan.periodStart)} 〜 {formatDateJa(plan.periodEnd)}
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              ({planPeriodDays(plan.periodStart, plan.periodEnd)}日間・
              {formatRemainingDays(plan.periodStart, plan.periodEnd, today)})
            </span>
          </p>
          {view.active && guidance.todayAllowanceYen !== null ? (
            <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              今日使える額 {formatYen(guidance.todayAllowanceYen, { sign: 'never' })}
              {guidance.dailyAllowanceYen !== null
                ? ` ・ 1日の目安 ${formatYen(guidance.dailyAllowanceYen, { sign: 'never' })}`
                : ''}
            </p>
          ) : null}

          <ul className="mt-3 space-y-0.5">
            {view.breakdown
              .filter((r) => r.targetYen !== null)
              .map((r) => (
                <li key={r.genreId ?? 'none'}>
                  <GenreBudgetRow
                    name={r.genreName}
                    spentYen={r.spentYen}
                    budgetYen={r.targetYen}
                    idealYen={view.ended ? null : r.idealYen}
                    maxYen={Math.max(...view.breakdown.map((x) => x.spentYen), 1)}
                  />
                </li>
              ))}
          </ul>

          {/* 特別費と予定は、ペース予測から除いて別の行で見せる */}
          {guidance.specialYen > 0 || guidance.scheduledYen > 0 ? (
            <dl
              className="tabular mt-3 space-y-1 border-t pt-3 text-xs"
              style={{ borderColor: 'var(--hairline)', color: 'var(--ink-secondary)' }}
            >
              {guidance.specialYen > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt>特別費(ペースに含めない)</dt>
                  <dd>{formatYen(guidance.specialYen, { sign: 'never' })}</dd>
                </div>
              ) : null}
              {guidance.scheduledYen > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt>予定(今日より先。ペースに含めない)</dt>
                  <dd>{formatYen(guidance.scheduledYen, { sign: 'never' })}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {/* 記録がない・目標のないジャンルは 0円の予算として並べず、「予算なし」に折りたたむ */}
          {view.noBudget.length > 0 ? (
            <details className="mt-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
              <summary
                className="cursor-pointer text-xs font-semibold"
                style={{ color: 'var(--ink-secondary)' }}
              >
                予算なし({view.noBudget.length}件)
              </summary>
              <ul className="mt-2 space-y-0.5">
                {view.noBudget.map((r) => (
                  <li key={r.genreId ?? 'none'}>
                    <GenreBudgetRow
                      name={r.genreName}
                      spentYen={r.spentYen}
                      budgetYen={null}
                      maxYen={Math.max(...view.noBudget.map((x) => x.spentYen), 1)}
                    />
                  </li>
                ))}
              </ul>
              {view.uncategorizedYen > 0 ? (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  未分類の {formatYen(view.uncategorizedYen, { sign: 'never' })}{' '}
                  は、ジャンルが決まるまで目標に反映されません。
                </p>
              ) : null}
            </details>
          ) : null}

          <div className="mt-4 space-y-3 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
            <EditPlanSection
              planId={plan.id}
              periodStart={plan.periodStart}
              periodEnd={plan.periodEnd}
              rows={plan.items.map((item) => ({
                genreId: item.genreId,
                genreName: item.genreName,
                baselineYen: null,
                note: item.reason,
                yen: item.targetYen,
              }))}
            />
            <DeletePlanButton planId={plan.id} />
          </div>
        </section>
      ) : null}

      <PlanBuilder today={today} payday={settings.payday} />
    </div>
  );
}
