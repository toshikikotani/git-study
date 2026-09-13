import Link from 'next/link';

import { listActiveGoals } from '@/features/goals/store';
import { ChatPanel } from './chat-panel';
import { GoalCard } from './goal-card';

/**
 * AI相談(目標設定・買う前相談、本人発案)。
 *
 * 「1、2、3いいねやろう」等の外部連携と違い、本人と直接対話する機能
 * のため、費用より対話の質を優先している(features/advisor/chat.ts 参照)。
 */

// 目標の進捗・保存直後の反映を常に見せる。App Router のキャッシュに乗せない。
export const dynamic = 'force-dynamic';

export default async function AdvisorPage() {
  const goals = await listActiveGoals();

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AI相談
        </h1>
        <Link href="/" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
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

      <ChatPanel />
    </div>
  );
}
