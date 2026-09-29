import Link from 'next/link';

import { listActiveGoals } from '@/features/goals/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GoalCard } from './goal-card';

/**
 * 目標(進行中の目標と進捗、本人発案)。
 *
 * 以前はここに「AI相談」のチャットがあったが、AIの窓口を1つにするため
 * /assistant へ統合した(ADR-059)。目標の作成・進捗の更新もそこの会話から
 * 変更案として行える。ここは進行中の目標を見て、手で進捗を直す画面として残す。
 */

// 目標の進捗・保存直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function AdvisorPage() {
  const goals = await withMinDuration(listActiveGoals());

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          目標
        </h1>
        <Link href="/" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          ホームへ戻る
        </Link>
      </header>

      {goals.length > 0 ? (
        <div className="space-y-3">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </div>
      ) : null}

      {goals.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          進行中の目標はまだありません。
        </p>
      ) : null}

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
