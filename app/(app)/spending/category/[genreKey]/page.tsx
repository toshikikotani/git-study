import { ScreenFrame } from '../../../screen-frame';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import { loadCategoryDetail } from '@/features/category/loader';
import { CategoryScreen } from './category-screen';

/**
 * カテゴリ詳細(家計簿のジャンル内訳・目標のジャンル行・未分類から開く)。
 * `?month=YYYY-MM` は家計簿の期間を引き継ぐ。数字はすべて家計簿と同じ集計関数の値。
 */
export const dynamic = 'force-dynamic';

export default function CategoryPage(props: {
  params: Promise<{ genreKey: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<ScreenFrame title="カテゴリ" />}>
      <CategoryPageBody {...props} />
    </Suspense>
  );
}

async function CategoryPageBody({
  params,
  searchParams,
}: {
  params: Promise<{ genreKey: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const { genreKey } = await params;
  const { month } = await searchParams;
  const data = await loadCategoryDetail({
    genreKey,
    month: Array.isArray(month) ? month[0] : month,
  });
  if (data === null) notFound();
  return <CategoryScreen data={data} />;
}
