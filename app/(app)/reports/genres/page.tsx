import Link from 'next/link';

import {
  countUngenredSpendTargetsAllPeriods,
  listGenres,
  loadGenreAnalysisView,
} from '@/features/genre/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GenreBreakdownCard } from './genre-breakdown-card';
import { GenreManageCard } from './genre-manage-card';
import { RiskyRulesCard } from './risky-rules-card';

/**
 * ジャンル管理・分析の入口(本人発案「投資家目線で客観的にジャンル細分化する
 * AIを作ってほしい。第三者の分類があると第三者目線での分析ができる」、
 * ADR-056/ADR-057)。
 *
 * ADR-057により、ジャンルは本人が決めていた主観的なカテゴリ(生活費・浪費
 * など)を置き換える唯一の分類になった。旧 /rules(カテゴリ管理)・
 * /reports/categories(カテゴリの掘り下げ)はどちらも廃止し、ジャンルの
 * 管理(追加削除・予算・ホーム表示)と分析をこの1画面に統合した。
 */

export const dynamic = 'force-dynamic';
// 「ジャンル分類する」の Server Action(AI呼び出し)はこのページの上限時間で動く。
export const maxDuration = 60;

export default async function GenresPage() {
  const [view, genres, allPendingCount] = await withMinDuration(
    Promise.all([loadGenreAnalysisView(), listGenres(), countUngenredSpendTargetsAllPeriods()]),
  );

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            ジャンル管理・分析
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            唯一の分類。追加削除・予算はここで、分類はAIが行う
          </p>
        </div>
        <Link href="/reports" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          レポートへ →
        </Link>
      </header>

      <GenreBreakdownCard
        entries={view.entries}
        initialPendingCount={view.pendingCount}
        initialAllPendingCount={allPendingCount}
      />

      <GenreManageCard genres={genres} />

      <RiskyRulesCard />
    </div>
  );
}
