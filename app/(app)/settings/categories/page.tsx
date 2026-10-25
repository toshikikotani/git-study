import { listGenres } from '@/features/genre/store';
import { backTargetOf, SETTINGS_BACK } from '@/lib/back-target';
import { CategoryList } from './category-list';

export const dynamic = 'force-dynamic';

/**
 * カテゴリ(デザイン仕様書の「カテゴリの設定」、ADR-090 → 113):名前を押すと、アイコン・色・目標額・
 * 固定費・ルール・削除を変えられる。似た名前のカテゴリは「まとめる」で1つにできる。設定から開き、今期の目標から
 * 開いたときは「‹ 今期の目標」へ戻る(ADR-127)。
 * 今日の画面に出すカテゴリは選ばない(目標をこえそうなものを自動で出す、ADR-117)。
 */
export default async function CategoriesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ from }, genres] = await Promise.all([searchParams, listGenres()]);
  return (
    <div className="rise flex flex-col gap-3">
      <CategoryList
        categories={genres.map((g) => ({ id: g.id, name: g.name }))}
        back={backTargetOf(from, SETTINGS_BACK)}
      />
    </div>
  );
}
