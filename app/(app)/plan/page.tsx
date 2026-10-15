import Link from 'next/link';
import { Suspense } from 'react';

import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { formatRemainingDays } from '@/domain/period';
import { loadGoalView } from '@/features/goals/loader';
import { getAppSettings } from '@/features/settings/store';
import { getCurrentPlan, listPlanRanges, type SpendingPlan } from '@/features/spending-plan/store';
import { categoryHref } from '@/lib/category-nav';
import { formatDateJa, todayJst } from '@/lib/date';
import { BudgetOverview } from './budget-overview';
import { PlanBuilder } from './plan-builder';
import { ReviewCard } from './review-card';

/** 設定が読めないときの給料日(期間のプリセットの起点にだけ使う)。 */
const DEFAULT_PAYDAY = 25;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 予算(目標と見通しを1つにした画面、ADR-088)。上に期間と「編集」、その下に着地の見込みから
 * カテゴリ・なぜ・AIの分析まで。期間・配分・予算のないカテゴリ・削除は「編集」(/plan/edit)へ。
 */
export default async function BudgetPage() {
  const today = todayJst();
  const plan = await getCurrentPlan(today).catch(() => null);
  const state =
    plan === null
      ? 'none'
      : today < plan.periodStart
        ? 'upcoming'
        : today > plan.periodEnd
          ? 'ended'
          : 'active';
  return (
    <div className="rise space-y-4">
      <header className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          {plan ? (
            <p className="text-sm font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {formatDateJa(plan.periodStart)}〜{formatDateJa(plan.periodEnd)} ·{' '}
              {formatRemainingDays(plan.periodStart, plan.periodEnd, today)}
            </p>
          ) : null}
          <h1
            className="text-[34px] leading-none font-bold tracking-[-0.03em]"
            style={{ color: 'var(--ink)' }}
          >
            予算
          </h1>
        </div>
        {plan && state !== 'ended' ? (
          <Link
            href="/plan/edit"
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--accent)' }}
          >
            編集
          </Link>
        ) : null}
      </header>

      {state === 'active' && plan ? (
        <Suspense fallback={<Waiting />}>
          <SafeOverview plan={plan} today={today} />
        </Suspense>
      ) : state === 'upcoming' && plan ? (
        <UpcomingPlan plan={plan} today={today} />
      ) : (
        <Suspense fallback={null}>
          <NoActivePlan today={today} ended={state === 'ended'} />
        </Suspense>
      )}
    </div>
  );
}

function Waiting() {
  return (
    <p className="text-sm" role="status" style={{ color: 'var(--ink-secondary)' }}>
      見込みを計算しています
    </p>
  );
}

/** 読み込みに失敗しても、ページ全体は落とさず、原因を見せる(編集やほかの画面は使える)。 */
async function SafeOverview({ plan, today }: { plan: SpendingPlan; today: string }) {
  try {
    return await BudgetOverview({ plan, today });
  } catch (error) {
    console.error('[budget] 予算の見込みを読み込めませんでした', error);
    const message = error instanceof Error ? error.message : String(error);
    return (
      <p role="alert" className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        予算の見込みを読み込めませんでした。しばらくしてからもう一度開いてください。
        <span className="tabular mt-1 block text-xs" style={{ color: 'var(--ink-muted)' }}>
          {message}
        </span>
      </p>
    );
  }
}

function UpcomingPlan({ plan, today }: { plan: SpendingPlan; today: string }) {
  const items = plan.items.filter((item) => item.targetYen > 0);
  return (
    <section
      aria-label="これから始まる予算"
      className="glass rounded-[28px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
        {formatDateJa(plan.periodStart)}
        から始まります。始まると、着地の見込みとカテゴリごとの様子を出します。
      </p>
      <ul className="mt-3 space-y-1">
        {items.map((item) => (
          <li key={item.genreId}>
            <GenreBudgetRow
              name={item.genreName}
              spentYen={0}
              budgetYen={item.targetYen}
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

async function NoActivePlan({ today, ended }: { today: string; ended: boolean }) {
  const [settings, ranges, loaded] = await Promise.all([
    getAppSettings().catch(() => null),
    listPlanRanges().catch(() => []),
    ended ? loadGoalView().catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <>
      {loaded?.view.review ? (
        <ReviewCard planId={loaded.plan.id} review={loaded.view.review} />
      ) : null}
      {!ended ? (
        <p className="px-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
          予算はまだありません。期間とカテゴリごとの額を決めると、着地の見込みを出します。
        </p>
      ) : null}
      <PlanBuilder
        today={today}
        payday={settings?.payday ?? DEFAULT_PAYDAY}
        ranges={ranges}
        activeEnd={null}
      />
    </>
  );
}
