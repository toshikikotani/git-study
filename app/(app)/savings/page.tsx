import Link from 'next/link';

import { formatYen } from '@/domain/money';
import { loadSavingsSummary } from '@/features/savings/store';
import { formatDateJa, todayJst } from '@/lib/date';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GoalCard } from './goal-card';
import { NewGoal } from './new-goal';

/**
 * 貯金(ADR-080)。借金の画面の代わりに、貯金目標と貯まり具合を見る。
 *
 * 貯まった額は「収入 − 支出」から自動で数える(手入力しない)。数え始めは、
 * 進行中の目標のうちいちばん早く作った日。合計は期限の近い目標から順に割り当てる。
 * 目標の作成は、ここか /assistant の会話から(ADR-059)。
 */

// 目標の作成・保存直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function SavingsPage() {
  const summary = await withMinDuration(loadSavingsSummary());
  const today = todayJst();

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          貯金
        </h1>
        <Link href="/" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          ホームへ戻る
        </Link>
      </header>

      <section
        className="rounded-[22px] px-4 py-4"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="貯まった"
            value={summary.startOn === null ? '—' : formatYen(summary.totalYen, { sign: 'never' })}
          />
          <Stat label="今月" value={formatYen(summary.thisMonthYen)} />
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

      {summary.goals.length > 0 ? (
        <div className="space-y-3">
          {summary.goals.map((progress) => (
            <GoalCard key={progress.goal.id} progress={progress} today={today} />
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          貯金目標はまだありません。何のために、いくら、いつまでに貯めたいかを決めると、
          毎月いくら残せばいいかが見えます。
        </p>
      )}

      <NewGoal />

      <Link
        href="/assistant"
        className="block text-xs font-medium"
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
