import Link from 'next/link';
import { redirect } from 'next/navigation';

import { formatYen } from '@/domain/money';
import { planPeriodDays } from '@/domain/spending-plan';
import { loadGoalView } from '@/features/goals/loader';
import { getAppSettings } from '@/features/settings/store';
import { listGenreOptions } from '@/features/spending-plan/membership';
import { getCurrentPlan, listPlanRanges } from '@/features/spending-plan/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { DeletePlanButton } from '../delete-plan-button';
import { EditPlanSection } from '../edit-plan-section';
import { PlanBuilder } from '../plan-builder';
import { UnrecordedSheet } from '../unrecorded-sheet';

const DEFAULT_PAYDAY = 25;

export const dynamic = 'force-dynamic';

/**
 * 予算を編集(デザインの「予算を編集」、ADR-088):期間・総額と配分・予算のないカテゴリ・次の期間・削除。
 * カテゴリ1つの目標額は、カテゴリの設定からも変えられる。
 */
export default async function BudgetEditPage() {
  const today = todayJst();
  const plan = await getCurrentPlan(today);
  if (plan === null) redirect('/plan');
  const [settings, ranges, genres, loaded] = await Promise.all([
    getAppSettings().catch(() => null),
    listPlanRanges().catch(() => []),
    listGenreOptions().catch(() => []),
    loadGoalView().catch(() => null),
  ]);
  const items = plan.items.filter((item) => item.targetYen > 0);
  const total = items.reduce((sum, item) => sum + item.targetYen, 0);
  const taken = new Set(items.map((item) => item.genreId));
  const addable = genres.filter((genre) => !taken.has(genre.genreId));
  const ended = today > plan.periodEnd;
  const section = 'glass space-y-3 rounded-[22px] p-4';
  const sectionStyle = { background: 'var(--surface)', boxShadow: 'var(--card-shadow)' };
  const heading = 'px-1 text-sm font-semibold';

  return (
    <div className="rise space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center text-sm font-semibold"
          style={{ color: 'var(--ink-secondary)' }}
        >
          ‹ 予算
        </Link>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          予算を編集
        </h1>
        <span className="w-12" aria-hidden />
      </header>

      <section aria-labelledby="edit-period" className="space-y-2">
        <h2 id="edit-period" className={heading} style={{ color: 'var(--ink-secondary)' }}>
          期間と金額
        </h2>
        <div className={section} style={sectionStyle}>
          <p className="text-sm" style={{ color: 'var(--ink)' }}>
            {formatDateJa(plan.periodStart)}〜{formatDateJa(plan.periodEnd)}(
            {planPeriodDays(plan.periodStart, plan.periodEnd)}日間)
          </p>
          <p className="tabular text-sm" style={{ color: 'var(--ink)' }}>
            総額 {formatYen(total, { sign: 'never' })} · カテゴリへの配分 {items.length}
          </p>
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
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            期間は給料日に合わせるのがおすすめです。カテゴリ1つの目標額は、カテゴリの設定からも変えられます。
          </p>
          <Link
            href="/settings/categories"
            className="inline-flex min-h-11 items-center text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            カテゴリの設定
          </Link>
        </div>
      </section>

      {loaded?.view && !loaded.view.ended ? (
        <section aria-labelledby="edit-nobudget" className="space-y-2">
          <h2 id="edit-nobudget" className={heading} style={{ color: 'var(--ink-secondary)' }}>
            予算のないカテゴリ
          </h2>
          <UnrecordedSheet planId={plan.id} rows={loaded.view.noBudget} addable={addable} />
        </section>
      ) : null}

      <section aria-labelledby="edit-next" className="space-y-2">
        <h2 id="edit-next" className={heading} style={{ color: 'var(--ink-secondary)' }}>
          次の期間
        </h2>
        <PlanBuilder
          today={today}
          payday={settings?.payday ?? DEFAULT_PAYDAY}
          ranges={ranges}
          activeEnd={ended ? null : plan.periodEnd}
        />
      </section>

      <div className="border-t pt-4 text-center" style={{ borderColor: 'var(--hairline)' }}>
        <DeletePlanButton planId={plan.id} />
      </div>
    </div>
  );
}
