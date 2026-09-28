import Link from 'next/link';

import { listGenres, loadGenreAnalysisView } from '@/features/genre/store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { GenreBreakdownCard } from './genre-breakdown-card';
import { GenreManageCard } from './genre-manage-card';

/**
 * ジャンル別分析の入口(本人発案「投資家目線で客観的にジャンル細分化する
 * AIを作ってほしい。第三者の分類があると第三者目線での分析ができる」、
 * ADR-056)。
 *
 * /reports/categories(P10-60)が本人のカテゴリを掘り下げる画面なのに対し、
 * こちらは本人のカテゴリとは独立した、AIによる客観的なジャンルで支出を
 * 横断的に見る画面——役割が違うので既存の画面には手を加えず、別ページに
 * した。
 */

export const dynamic = 'force-dynamic';

export default async function GenresPage() {
  const [view, genres] = await withMinDuration(
    Promise.all([loadGenreAnalysisView(), listGenres()]),
  );

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            ジャンル別分析
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            本人のカテゴリとは独立した、AIによる客観的な分類
          </p>
        </div>
        <Link href="/reports" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          レポートへ →
        </Link>
      </header>

      <GenreBreakdownCard entries={view.entries} initialPendingCount={view.pendingCount} />

      <GenreManageCard genres={genres} />
    </div>
  );
}
