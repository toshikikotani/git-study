import Link from 'next/link';

import { BackHeader } from '@/components/ui/back-header';
import { formatYen } from '@/domain/money';
import { loadSavingsSummary } from '@/features/savings/store';
import { getAppSettings } from '@/features/settings/store';
import { backTargetOf } from '@/lib/back-target';
import { formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GoalCard } from './goal-card';
import { MonthlyTarget } from './monthly-target';
import { NewGoal } from './new-goal';

/**
 * 貯金(ADR-081)。借金の画面の代わりに、貯金目標と貯まり具合を見る。
 * 貯金目標は1つ(ADR-127):毎月の額が目標で、今日の画面とAIも同じ値を見る(ADR-108)。「何のために・いくら・
 * いつまでに」はその目標のくわしい内容(任意)。前につくった目標が複数あれば、2つ目からはたたんで出す。
 *
 * 貯まった額は「収入 − 支出」から自動で数える(手入力しない)。数え始めは、
 * 進行中の目標のうちいちばん早く作った日。合計は期限の近い目標から順に割り当てる。
 * 目標の作成は、ここか /assistant の会話から(ADR-059)。
 */

// 目標の作成・保存直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  const [summary, settings] = await Promise.all([
    withMinDuration(loadSavingsSummary()),
    getAppSettings().catch(() => null),
  ]);
  const today = todayJst();

  const [primary, ...older] = summary.goals;
  const target = settings?.monthlySavingsTargetYen ?? 0;

  return (
    <div className="rise space-y-4">
      <BackHeader back={backTargetOf(from)} title="貯金" />

      {/* 貯金目標は1つ(提案書、ADR-127):毎月の額が目標。「何のために・いくら・いつまでに」はその目標の
          くわしい内容(任意)。今日・貯金・AIは、どれもこの毎月の額で「あといくら」を出す。 */}
      <section
        aria-labelledby="savings-target"
        className="flex flex-col gap-3 rounded-[22px] px-4 py-4"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}
      >
        <h2 id="savings-target" className="text-[17px] font-semibold">
          貯金目標
        </h2>
        <MonthlyTarget initialYen={target} />
        {primary ? <GoalCard progress={primary} today={today} /> : <NewGoal />}
        {primary?.monthlyNeededYen != null && primary.monthlyNeededYen !== target ? (
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            期限に間に合わせるには、毎月 {formatYen(primary.monthlyNeededYen, { sign: 'never' })}{' '}
            ほど要ります。毎月の額に入れると、今日の画面とAIもこの額で見ます。
          </p>
        ) : null}
      </section>

      <section
        className="glass rounded-[22px] px-4 py-4"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="貯まった"
            value={summary.startOn === null ? '—' : formatYen(summary.totalYen, { sign: 'never' })}
          />
          <Stat label="今月の収支" value={formatYen(summary.thisMonthYen)} />
          <Stat
            label="いつもの月"
            value={summary.paceYen === null ? '—' : formatYen(summary.paceYen)}
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          収入 − 支出で自動で数えます(振替・対象外は数えません)。
          {summary.startOn !== null
            ? `${formatDateJa(summary.startOn)}から数えています。`
            : '目標をつくった日から数え始めます。'}
          「いつもの月」は、直近3か月の平均です。
        </p>
      </section>

      {older.length > 0 ? (
        <details className="rounded-[22px] px-4" style={{ background: 'var(--surface)' }}>
          <summary
            className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            前につくった目標({older.length}件)
          </summary>
          <div className="space-y-3 pb-4">
            {older.map((progress) => (
              <GoalCard key={progress.goal.id} progress={progress} today={today} />
            ))}
          </div>
        </details>
      ) : null}

      <Link
        href="/assistant?context=savings"
        className="flex min-h-11 items-center text-xs font-medium"
        style={{ color: 'var(--accent)' }}
      >
        AIに相談して目標を立てる →
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p className="tabular mt-1 truncate text-base font-semibold" style={{ color: 'var(--ink)' }}>
        {value}
      </p>
    </div>
  );
}
