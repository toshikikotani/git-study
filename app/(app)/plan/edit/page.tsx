import Link from 'next/link';
import { redirect } from 'next/navigation';

import { formatEstimate } from '@/domain/forecast/format';
import { planPeriodDays } from '@/domain/spending-plan';
import { loadGoalView } from '@/features/goals/loader';
import { getAppSettings } from '@/features/settings/store';
import { listGenreOptions } from '@/features/spending-plan/membership';
import { getCurrentPlan, listPlanRanges } from '@/features/spending-plan/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { DeletePlanButton } from '../delete-plan-button';
import { PlanAllocationForm, PlanPeriodForm } from '../edit-plan-section';
import { PlanBuilder } from '../plan-builder';
import { UnrecordedSheet } from '../unrecorded-sheet';

const DEFAULT_PAYDAY = 25;

export const dynamic = 'force-dynamic';

const group = 'glass overflow-hidden rounded-[22px]';
const groupStyle = { background: 'var(--surface)', boxShadow: 'var(--card-shadow)' } as const;
const caption = 'px-4 text-sm';

/**
 * 予算を編集(デザインの「予算を編集」、ADR-088):行の一覧(期間・金額・次の期間・削除)。
 * 行を押すと、その場で編集欄が開く。カテゴリ1つの目標額は、カテゴリの設定からも変えられる。
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
  const allocationRows = plan.items.map((item) => ({
    genreId: item.genreId,
    genreName: item.genreName,
    baselineYen: null,
    note: item.reason,
    yen: item.targetYen,
  }));

  return (
    <div className="rise space-y-6">
      <header className="grid grid-cols-3 items-center">
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center justify-self-start text-base"
          style={{ color: 'var(--accent)' }}
        >
          ‹ 予算
        </Link>
        <h1
          className="justify-self-center text-base font-semibold whitespace-nowrap"
          style={{ color: 'var(--ink)' }}
        >
          予算を編集
        </h1>
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center justify-self-end text-base font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          完了
        </Link>
      </header>

      <section aria-labelledby="edit-period" className="space-y-2">
        <h2 id="edit-period" className={caption} style={{ color: 'var(--ink-secondary)' }}>
          期間
        </h2>
        <div className={group} style={groupStyle}>
          <Row
            label="期間"
            value={`${formatDateJa(plan.periodStart)}〜${formatDateJa(plan.periodEnd)}`}
          >
            <PlanPeriodForm
              planId={plan.id}
              periodStart={plan.periodStart}
              periodEnd={plan.periodEnd}
            />
          </Row>
        </div>
        <p className={caption} style={{ color: 'var(--ink-secondary)' }}>
          {planPeriodDays(plan.periodStart, plan.periodEnd)}日間。給料日に合わせるのがおすすめです。
        </p>
      </section>

      <section aria-labelledby="edit-money" className="space-y-2">
        <h2 id="edit-money" className={caption} style={{ color: 'var(--ink-secondary)' }}>
          金額
        </h2>
        <div className={group} style={groupStyle}>
          <Row
            label="総額とカテゴリへの配分"
            value={`${formatEstimate(total, { approx: false })} · ${items.length}`}
          >
            <PlanAllocationForm
              planId={plan.id}
              periodStart={plan.periodStart}
              periodEnd={plan.periodEnd}
              rows={allocationRows}
            />
          </Row>
          <Divider />
          <Link
            href="/settings/categories"
            className="flex min-h-12 items-center justify-between gap-3 px-4 text-base"
            style={{ color: 'var(--ink)' }}
          >
            <span>カテゴリの設定</span>
            <Chevron />
          </Link>
        </div>
        {loaded?.view && !loaded.view.ended ? (
          <UnrecordedSheet planId={plan.id} rows={loaded.view.noBudget} addable={addable} />
        ) : null}
      </section>

      <section aria-labelledby="edit-next" className="space-y-2">
        <h2 id="edit-next" className={caption} style={{ color: 'var(--ink-secondary)' }}>
          次の期間
        </h2>
        <PlanBuilder
          today={today}
          payday={settings?.payday ?? DEFAULT_PAYDAY}
          ranges={ranges}
          activeEnd={ended ? null : plan.periodEnd}
        />
      </section>

      <div className={`${group} py-1 text-center`} style={groupStyle}>
        <DeletePlanButton planId={plan.id} />
      </div>
    </div>
  );
}

/** 押すとその場で開く行(左に名前、右に今の値と ›)。 */
function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary
        className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-base"
        style={{ color: 'var(--ink)' }}
      >
        <span>{label}</span>
        <span
          className="tabular flex min-w-0 items-center gap-2 truncate"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {value}
          <Chevron />
        </span>
      </summary>
      <div className="px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}

function Divider() {
  return <div className="ml-4 h-px" style={{ background: 'var(--hairline)' }} />;
}

function Chevron() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 transition-transform group-open:rotate-90"
      style={{ color: 'var(--ink-muted)' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
