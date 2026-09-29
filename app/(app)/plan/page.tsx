import { Meter } from '@/components/ui/meter';
import { formatYen } from '@/domain/money';
import {
  planGuidance,
  planPeriodDays,
  planProgress,
  type GuidanceStatus,
} from '@/domain/spending-plan';
import { getLatestPlan, loadGenreSpend } from '@/features/spending-plan/store';
import { addDays, daysBetween, formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { DeletePlanButton } from './delete-plan-button';
import { EditPlanSection } from './edit-plan-section';
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

  const guidance =
    plan !== null && latestSpend !== null
      ? planGuidance({
          periodStart: plan.periodStart,
          periodEnd: plan.periodEnd,
          today,
          items: plan.items.map((item) => ({
            genreId: item.genreId,
            genreName: item.genreName,
            targetYen: item.targetYen,
            spentYen: latestSpend.byGenre.get(item.genreId) ?? 0,
          })),
        })
      : null;
  const messageByGenre = new Map(guidance?.genres.map((g) => [g.genreId, g.message]));

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

      {guidance !== null ? (
        <div
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
        </div>
      ) : null}

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
                  <p
                    className="mt-1 text-[11px] leading-relaxed"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {messageByGenre.get(item.genreId)}
                  </p>
                </li>
              );
            })}
          </ul>

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
        </div>
      ) : null}

      <PlanBuilder today={today} />
    </div>
  );
}

const STATUS_LABEL: Record<GuidanceStatus, string> = {
  not_started: 'これから',
  on_track: '順調',
  watch: 'もう少しで目標',
  over_pace: 'ペースが速め',
  over: '目標を超えています',
  ended: '達成',
};

const STATUS_COLOR: Record<GuidanceStatus, string> = {
  not_started: 'var(--ink-muted)',
  on_track: 'var(--income)',
  watch: 'var(--accent)',
  over_pace: 'var(--over)',
  over: 'var(--over)',
  ended: 'var(--income)',
};

function periodStatus(start: string, end: string, today: string): string {
  if (today < start) return `${daysBetween(today, start)}日後に開始`;
  if (today > end) return '終了';
  return `残り${daysBetween(today, addDays(end, 1))}日`;
}
