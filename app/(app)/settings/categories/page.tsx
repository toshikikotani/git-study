import { listGenres } from '@/features/genre/store';
import { CategoryList } from './category-list';

export const dynamic = 'force-dynamic';

/**
 * カテゴリ(デザイン仕様書の「カテゴリの設定」、ADR-090):ホームに出すカテゴリとそのほかに分け、
 * スイッチでホームに出すかを決める。名前を押すと、アイコン・色・目標額・固定費・ルール・削除を変えられる。
 * 似た名前のカテゴリは「まとめる」で1つにできる。
 */
export default async function CategoriesSettingsPage() {
  const genres = await listGenres();
  return (
    <div className="rise flex flex-col gap-3">
      <CategoryList
        categories={genres.map((g) => ({ id: g.id, name: g.name, showOnHome: g.showOnHome }))}
      />
    </div>
  );
}
