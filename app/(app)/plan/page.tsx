import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { formatYen } from '@/domain/money';
import { formatRemainingDays } from '@/domain/period';
import { planPeriodDays } from '@/domain/spending-plan';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { buildGoalCard } from '@/features/goals/card';
import { loadGoalView } from '@/features/goals/loader';
import { listPlanRanges } from '@/features/spending-plan/store';
import { getAppSettings } from '@/features/settings/store';
import { categoryHref } from '@/lib/category-nav';
import { formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GoalCard } from './goal-card';
import { DeletePlanButton } from './delete-plan-button';
import { EditPlanSection } from './edit-plan-section';
import { PlanBuilder } from './plan-builder';
import { ReviewCard } from './review-card';
import { ExcludeGenreButton, UnrecordedSheet } from './unrecorded-sheet';

/**
 * 目標。主役は期間の残り。期間中に発生したのに行が無い支出は未収録として面上に出し、
 * その場で目標へ加えるか、分類へ送る。予算なしの折りたたみと要対応の文章は置かない。
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function PlanPage() {
  const today = todayJst();
  const [loaded, settings, ranges, captures] = await withMinDuration(
    Promise.all([
      loadGoalView(),
      getAppSettings(),
      listPlanRanges(),
      listOpenCaptures().catch(() => []),
    ]),
  );
  const plan = loaded?.plan ?? null;
  const view = loaded?.view ?? null;
  const guidance = view?.guidance ?? null;

  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          目標
        </h1>
      </header>

      {view?.review && plan ? <ReviewCard planId={plan.id} review={view.review} /> : null}

      {view !== null && guidance !== null && !view.ended ? (
        <>
          <GoalCard model={buildGoalCard(view, today, { pendingCount: captures.length })} />
          <UnrecordedSheet planId={plan!.id} rows={view.noBudget} />
        </>
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
          <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {formatDateJa(plan.periodStart)} 〜 {formatDateJa(plan.periodEnd)}
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              ({planPeriodDays(plan.periodStart, plan.periodEnd)}日間・
              {formatRemainingDays(plan.periodStart, plan.periodEnd, today)})
            </span>
          </p>
          <ul className="mt-3 space-y-1">
            {view.breakdown
              .filter((r) => r.targetYen !== null)
              .map((r) => (
                <li key={r.genreId ?? 'none'}>
                  <GenreBudgetRow
                    name={r.genreName}
                    spentYen={r.spentYen}
                    budgetYen={r.targetYen}
                    idealYen={view.ended ? null : r.idealYen}
                    scheduledYen={r.scheduledYen}
                    href={categoryHref(r.genreId ?? 'none', today)}
                    sharedKey={r.genreId ?? 'none'}
                    maxYen={Math.max(...view.breakdown.map((x) => x.spentYen), 1)}
                  />
                  {r.genreId ? <ExcludeGenreButton planId={plan.id} genreId={r.genreId} /> : null}
                </li>
              ))}
          </ul>

          {guidance.specialYen > 0 ? (
            <p
              className="tabular mt-3 border-t pt-3 text-xs"
              style={{ borderColor: 'var(--hairline)', color: 'var(--ink-secondary)' }}
            >
              特別費(ペースに含めない) {formatYen(guidance.specialYen, { sign: 'never' })}
            </p>
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
          </div>
        </section>
      ) : null}

      <PlanBuilder
        today={today}
        payday={settings.payday}
        ranges={ranges}
        activeEnd={view?.active ? view.range.to : null}
      />

      {plan ? (
        <div className="border-t pt-4 text-center" style={{ borderColor: 'var(--hairline)' }}>
          <DeletePlanButton planId={plan.id} />
        </div>
      ) : null}
    </div>
  );
}
