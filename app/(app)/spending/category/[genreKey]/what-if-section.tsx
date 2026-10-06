import { loadCategoryWhatIf } from '@/features/forecast/what-if';
import { WhatIfCard } from './what-if-card';

/**
 * 「もし、へらしたら」の読み込み(サーバー)。予測は重いので、カテゴリ画面の他の部分を
 * 待たせないよう Suspense の中で読む。出せない(定常型でない・残りが1週間未満・失敗)ときは何も出さない。
 */
export async function WhatIfSection(props: {
  genreId: string;
  genreName: string;
  genreBudgetYen: number | null;
}) {
  const view = await loadCategoryWhatIf(props).catch((error: unknown) => {
    console.error('[category] もしの試算を読み込めませんでした', error);
    return null;
  });
  if (view === null) return null;
  return <WhatIfCard view={view} />;
}
