import { Meter } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import { planPeriodDays, planProgress } from '@/domain/spending-plan';
import { getLatestPlan, loadGenreSpend } from '@/features/spending-plan/store';
import { addDays, daysBetween, formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { DeletePlanButton } from './delete-plan-button';
import { PlanBuilder } from './plan-builder';

/**
 * 支出目標(本人発案「カレンダーの範囲を選択して、そこまでの支出目標を立てたい。
 * AIと相談してカテゴリごとに目標設定する。まずはAIから大体これぐらいと付けて
 * もらってそこからユーザーが変更する。徐々に改善をかけれるような設定で、
 * 課題からこれぐらいにする」、ADR-058)。
 *
 * 上に直近の目標の進み具合、下に新しい目標を立てる画面。目標は期間ごとに
 * 立て直していき、前回の結果(達成/未達)が次の提案に反映される。
 */

export const dynamic = 'force-dynamic';
// 「AIに目標案を作ってもらう」の Server Action はこのページの上限時間で動く。
export const maxDuration = 60;

export default async function PlanPage() {
  const today = todayJst();
  const [plan, latestSpend] = await withMinDuration(
    getLatestPlan().then(async (latest) => [
      latest,
      latest === null ? null : await loadGenreSpend(latest.periodStart, latest.periodEnd),
    ]),
  );

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

      {plan !== null && latestSpend !== null ? (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            今の目標
          </p>
          <p className="mt-0.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {formatDateJa(plan.periodStart)} 〜 {formatDateJa(plan.periodEnd)}
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              ({planPeriodDays(plan.periodStart, plan.periodEnd)}日間・
              {periodStatus(plan.periodStart, plan.periodEnd, today)})
            </span>
          </p>

          <ul className="mt-4 space-y-3.5">
            {plan.items.map((item) => {
              const progress = planProgress(
                latestSpend.byGenre.get(item.genreId) ?? 0,
                item.targetYen,
              );
              return (
                <li key={item.genreId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm" style={{ color: 'var(--ink)' }}>
                      {item.genreName}
                    </span>
                    <span className="tabular shrink-0 text-sm" style={{ color: 'var(--ink)' }}>
                      {formatYen(progress.spentYen, { sign: 'never' })}
                      <span style={{ color: 'var(--ink-muted)' }}>
                        {' / '}
                        {formatYen(item.targetYen, { sign: 'never' })}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Meter
                      ratio={progress.ratio}
                      tone={progress.tone === 'over' ? 'over' : 'normal'}
                      label={`${item.genreName}の目標の消化`}
                    />
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {progress.remainingYen >= 0
                      ? `あと${formatYen(progress.remainingYen, { sign: 'never' })}`
                      : `${formatYen(-progress.remainingYen, { sign: 'never' })}超過`}
                    {item.reason ? ` ・ ${item.reason}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="mt-4">
            <DeletePlanButton planId={plan.id} />
          </div>
        </div>
      ) : null}

      <PlanBuilder today={today} />
    </div>
  );
}

function periodStatus(start: string, end: string, today: string): string {
  if (today < start) return `${daysBetween(today, start)}日後に開始`;
  if (today > end) return '終了';
  return `残り${daysBetween(today, addDays(end, 1))}日`;
}
