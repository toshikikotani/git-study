import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { loadCategoryDetail } from '@/features/category/loader';
import { genreIdOfKey } from '@/features/category/model';
import { CategoryScreen } from './category-screen';
import { WhatIfSection } from './what-if-section';

/**
 * カテゴリ詳細(家計簿のジャンル内訳・目標のジャンル行・未分類から開く)。
 * `?month=YYYY-MM` は家計簿の期間を引き継ぐ。数字はすべて家計簿と同じ集計関数の値。
 */
export const dynamic = 'force-dynamic';

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ genreKey: string }>;
  searchParams: Promise<{ month?: string | string[]; period?: string | string[] }>;
}) {
  const { genreKey } = await params;
  const { month, period } = await searchParams;
  const periodStr = Array.isArray(period) ? period[0] : period;
  const data = await loadCategoryDetail({
    genreKey,
    month: Array.isArray(month) ? month[0] : month,
    ...(periodStr === 'month' || periodStr === 'goal' ? { period: periodStr } : {}),
  });
  if (data === null) notFound();
  // 「もし、へらしたら」は目標の期間中だけ(目標のあるカテゴリ。予測を止めたものと未分類は出さない)。
  const genreId = genreIdOfKey(genreKey);
  const whatIf =
    data.isCurrentMonth &&
    data.goal?.active &&
    data.goal.row?.targetYen != null &&
    genreId !== null &&
    !data.forecastClosed ? (
      <Suspense fallback={null}>
        <WhatIfSection
          genreId={genreId}
          genreName={data.genreName}
          genreBudgetYen={data.genreBudgetYen}
        />
      </Suspense>
    ) : null;
  return <CategoryScreen data={data} whatIf={whatIf} />;
}
