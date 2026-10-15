import Link from 'next/link';

import { countUngenredSpendTargetsAllPeriods, loadGenreAnalysisView } from '@/features/genre/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GenreBreakdownCard } from './genre-breakdown-card';
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
 *
 * その後、カテゴリの管理は「設定 > カテゴリ」(/settings/categories)へ一本化し、
 * この画面は分析だけにした(設定の入口が散らばっていたため)。
 */

export const dynamic = 'force-dynamic';
// 「ジャンル分類する」の Server Action(AI呼び出し)はこのページの上限時間で動く。
export const maxDuration = 60;

export default async function GenresPage() {
  const [view, allPendingCount] = await withMinDuration(
    Promise.all([loadGenreAnalysisView(), countUngenredSpendTargetsAllPeriods()]),
  );

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            カテゴリ分析
          </h1>
          <Link
            href="/settings/categories"
            className="inline-flex min-h-11 items-center text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            カテゴリの追加・名前・目標額などは「設定 &gt; カテゴリ」へ
          </Link>
        </div>
        <Link
          href="/reports"
          className="inline-flex min-h-11 shrink-0 items-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          レポートへ →
        </Link>
      </header>

      <GenreBreakdownCard
        entries={view.entries}
        initialPendingCount={view.pendingCount}
        initialAllPendingCount={allPendingCount}
      />

      <RiskyRulesCard />
    </div>
  );
}
