import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { formatYen } from '@/domain/money';
import { loadCategorySummaries } from '@/features/categories/category-timeline-store';
import { withMinDuration } from '@/lib/min-loading-duration';

/**
 * カテゴリ別ページの入口(本人発案:「カテゴリ別で別のページ用意してその分析」)。
 *
 * /reports のカテゴリ別支出推移(P6-2)は直近6ヶ月・全カテゴリを1画面に
 * 並べる「見比べる」ための画面。こちらは1つのカテゴリを選んで、年→月→日と
 * 深掘りする「掘り下げる」ための画面——役割が違うので既存のグラフには
 * 手を加えず、別ページとして追加した。
 */

export const dynamic = 'force-dynamic';

export default async function CategoriesReportPage() {
  const categories = await withMinDuration(loadCategorySummaries());

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            カテゴリ別の分析
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            カテゴリを選ぶと、年→月→日で支出を掘り下げられます
          </p>
        </div>
        <Link href="/reports" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          レポートへ戻る
        </Link>
      </header>

      {categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          カテゴリがまだありません。
        </p>
      ) : (
        <div className="space-y-2.5">
          {categories.map((category) => (
            <Link key={category.id} href={`/reports/categories/${category.id}`}>
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    {category.name}
                  </span>
                  <span className="tabular text-sm" style={{ color: 'var(--ink-secondary)' }}>
                    {formatYen(category.totalYen, { sign: 'never' })}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  直近12ヶ月の合計
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
