import { Suspense } from 'react';
import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { formatYen } from '@/domain/money';
import { formatRemainingDays } from '@/domain/period';
import { planPeriodDays } from '@/domain/spending-plan';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { buildGoalCard } from '@/features/goals/card';
import { loadGoalView } from '@/features/goals/loader';
import { listGenreOptions } from '@/features/spending-plan/membership';
import { getCurrentPlan, listPlanRanges, type SpendingPlan } from '@/features/spending-plan/store';
import { getAppSettings } from '@/features/settings/store';
import { categoryHref } from '@/lib/category-nav';
import { formatDateJa, todayJst } from '@/lib/date';
import { GoalCard } from './goal-card';
import { DeletePlanButton } from './delete-plan-button';
import { EditPlanSection } from './edit-plan-section';
import { PlanBuilder } from './plan-builder';
import { ReviewCard } from './review-card';
import { UnrecordedSheet } from './unrecorded-sheet';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default function PlanPage() {
  return (
    <Suspense fallback={<PlanFrame />}>
      <PlanOutline />
    </Suspense>
  );
}

function PlanFrame() {
  return (
    <div role="status" aria-label="目標を読み込み中" className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        目標
      </h1>
      <div
        className="h-36 rounded-3xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
      <div
        className="h-24 rounded-2xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
      <div
        className="h-64 rounded-2xl"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      />
    </div>
  );
}

/** 予算の行だけ先に出す。実績・予定・編集用の設定は、開いてから取る。 */
async function PlanOutline() {
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  return (
    <div className="rise space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          目標
        </h1>
      </header>
      <Suspense fallback={<BudgetRows plan={plan} today={today} />}>
        <SpentRows today={today} />
      </Suspense>
      <Suspense fallback={null}>
        <PlanExtras
          today={today}
          activeEnd={plan && today <= plan.periodEnd ? plan.periodEnd : null}
        />
      </Suspense>
    </div>
  );
}

function BudgetRows({ plan, today }: { plan: SpendingPlan | null; today: string }) {
  if (plan === null)
    return (
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        目標はまだありません。
      </p>
    );
  return (
    <section
      aria-label="今の目標"
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        今の目標
      </p>
      <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {formatDateJa(plan.periodStart)} 〜 {formatDateJa(plan.periodEnd)}
        <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
          ({planPeriodDays(plan.periodStart, plan.periodEnd)}日間・
          {formatRemainingDays(plan.periodStart, plan.periodEnd, today)})
        </span>
      </p>
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
        実績を読み込み中
      </p>
      <ul className="mt-3 space-y-1">
        {plan.items
          .filter((item) => item.targetYen > 0)
          .map((item) => (
            <li key={item.genreId}>
              <GenreBudgetRow
                name={item.genreName}
                spentYen={0}
                budgetYen={item.targetYen}
                idealYen={null}
                scheduledYen={0}
                href={categoryHref(item.genreId, today)}
                sharedKey={item.genreId}
                maxYen={item.targetYen}
              />
            </li>
          ))}
      </ul>
    </section>
  );
}

async function SpentRows({ today }: { today: string }) {
  const loaded = await loadGoalView();
  const plan = loaded?.plan ?? null;
  const view = loaded?.view ?? null;
  const guidance = view?.guidance ?? null;
  if (plan === null || view === null || guidance === null) return null;
  return (
    <>
      {view.review ? <ReviewCard planId={plan.id} review={view.review} /> : null}
      {!view.ended ? <GoalCard model={buildGoalCard(view, today)} /> : null}
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
      <div className="border-t pt-4 text-center" style={{ borderColor: 'var(--hairline)' }}>
        <DeletePlanButton planId={plan.id} />
      </div>
    </>
  );
}

async function PlanExtras({ today, activeEnd }: { today: string; activeEnd: string | null }) {
  const [settings, ranges, captures, genres, loaded] = await Promise.all([
    getAppSettings(),
    listPlanRanges(),
    listOpenCaptures().catch(() => []),
    listGenreOptions().catch(() => []),
    loadGoalView().catch(() => null),
  ]);
  const plan = loaded?.plan ?? null;
  const taken = new Set(
    (plan?.items ?? []).filter((item) => item.targetYen > 0).map((item) => item.genreId),
  );
  const addable = genres.filter((genre) => !taken.has(genre.genreId));
  return (
    <>
      {plan && loaded?.view && !loaded.view.ended ? (
        <UnrecordedSheet planId={plan.id} rows={loaded.view.noBudget} addable={addable} />
      ) : null}
      <PlanBuilder today={today} payday={settings.payday} ranges={ranges} activeEnd={activeEnd} />
      {captures.length > 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          入力待ち {captures.length}件
        </p>
      ) : null}
    </>
  );
}
