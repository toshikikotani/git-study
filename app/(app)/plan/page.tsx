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

/** 2026-10-01 → 10月1日 */
function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/**
 * 見通し(デザイン仕様書の「見通し」、ADR-090)。「今日」から開く。上に「‹ 今日」と「目標を編集」、
 * 期間と残りの日数、その下に見込み・確率・なぜ・勢い・AIの気づき。期間・配分・予算のないカテゴリ・
 * 削除は「今期の目標」(/plan/edit)へ。
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
    <div className="rise flex flex-col gap-4">
      <div className="flex min-h-11 items-center justify-between">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-1 text-[17px] font-medium"
          style={{ color: 'var(--accent)' }}
        >
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          今日
        </Link>
        {plan && state !== 'ended' ? (
          <Link
            href="/plan/edit"
            className="flex min-h-11 items-center px-1 text-[17px] font-medium"
            style={{ color: 'var(--accent)' }}
          >
            目標を編集
          </Link>
        ) : null}
      </div>
      <header className="-mt-2 px-1">
        <h1 className="text-[34px] leading-tight font-bold" style={{ color: 'var(--ink)' }}>
          見通し
        </h1>
        {plan ? (
          <p className="tabular text-[15px]" style={{ color: 'var(--ink-muted)' }}>
            {dayLabel(plan.periodStart)}〜{dayLabel(plan.periodEnd)} ·{' '}
            {formatRemainingDays(plan.periodStart, plan.periodEnd, today)}
          </p>
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
      aria-label="これから始まる目標"
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)' }}
    >
      <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
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
        <p className="px-1 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          目標はまだありません。期間とカテゴリごとの額を決めると、着地の見込みを出します。
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
