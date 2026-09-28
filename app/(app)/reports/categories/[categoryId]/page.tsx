import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCategoryTimeline } from '@/features/categories/category-timeline-store';
import { withMinDuration } from '@/lib/min-loading-duration';
import { CategoryTrendBars } from '../category-trend-bars';
import { CategoryTimelineDrilldown } from '../category-timeline-drilldown';

/**
 * カテゴリ別ページの詳細(本人発案:「カテゴリ別で別のページ用意してその分析」)。
 *
 * 上段:直近12ヶ月の月次推移(依頼の「月次推移(直近6〜12ヶ月)」)。
 * 下段:年→月→日のドリルダウン(依頼の「年選択しといてタップしたら月
 * 月から日……自由に切り替える」)。時間(何時に使ったか)は
 * transactions.occurred_on が date 型で時刻を持たないため対象外——本人に
 * 確認済み(年→月→日の3段階のみ)。
 */

export const dynamic = 'force-dynamic';

export default async function CategoryTimelinePage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const timeline = await withMinDuration(loadCategoryTimeline(categoryId));
  if (!timeline) notFound();

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          {timeline.categoryName}
        </h1>
        <Link
          href="/reports/categories"
          className="text-[13px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          一覧へ戻る
        </Link>
      </header>

      <CategoryTrendBars monthKeys={timeline.monthKeys} monthly={timeline.monthly} />

      <CategoryTimelineDrilldown transactions={timeline.transactions} />
    </div>
  );
}
