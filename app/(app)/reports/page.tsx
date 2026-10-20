import { Suspense } from 'react';

import { GenreBudgetRow } from '@/components/ui/genre-budget-row';
import { SettingsLink } from '@/components/ui/settings-link';
import { loadGoalView } from '@/features/goals/loader';
import { getAppSettings } from '@/features/settings/store';
import { getCurrentPlan, listPlanRanges, type SpendingPlan } from '@/features/spending-plan/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { PlanBuilder } from '../plan/plan-builder';
import { ReviewCard } from '../plan/review-card';
import { AnalysisTabs } from './analysis-tabs';
import { GoalAnalysis } from './goal-analysis';

/** 設定が読めないときの給料日(期間のプリセットの起点にだけ使う)。 */
const DEFAULT_PAYDAY = 25;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 分析 › 目標(デザイン仕様書の「4a」、ADR-091)。ナビの「分析」で開く。旧「見通し」をまとめ、
 * いまの状況・どこで使っているか・ペース・次にできること・くわしく を1画面に並べる。
 * 目標が無ければ作り方、これから始まる目標ならその予定を出す。
 */
export default async function AnalysisGoalPage() {
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
    <div className="rise flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2 px-1 pt-2">
        <h1 className="text-[34px] leading-tight font-bold" style={{ color: 'var(--ink)' }}>
          分析
        </h1>
        <SettingsLink />
      </header>
      <AnalysisTabs current="goal" />
      {state === 'active' && plan ? (
        <Suspense fallback={<Waiting />}>
          <SafeAnalysis plan={plan} today={today} />
        </Suspense>
      ) : state === 'upcoming' && plan ? (
        <UpcomingPlan plan={plan} />
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
    <p className="px-1 text-[15px]" role="status" style={{ color: 'var(--ink-muted)' }}>
      見込みを計算しています
    </p>
  );
}

/** 読み込みに失敗しても、ページ全体は落とさず、原因を見せる(編集やほかの画面は使える)。 */
async function SafeAnalysis({ plan, today }: { plan: SpendingPlan; today: string }) {
  try {
    return await GoalAnalysis({ plan, today });
  } catch (error) {
    console.error('[analysis] 目標の分析を読み込めませんでした', error);
    const message = error instanceof Error ? error.message : String(error);
    return (
      <p
        role="alert"
        className="px-1 text-[15px] leading-relaxed"
        style={{ color: 'var(--ink-secondary)' }}
      >
        目標の分析を読み込めませんでした。しばらくしてからもう一度開いてください。
        <span className="tabular mt-1 block text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {message}
        </span>
      </p>
    );
  }
}

function UpcomingPlan({ plan }: { plan: SpendingPlan }) {
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
