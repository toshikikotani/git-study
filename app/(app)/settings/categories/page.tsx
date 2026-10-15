import { listGenres } from '@/features/genre/store';
import { CategoryList } from './category-list';

export const dynamic = 'force-dynamic';

/**
 * 設定 > カテゴリ。カテゴリの追加・ホームに出すかをここで決め、行を開くと
 * 名前・見た目・目標額(または月の目安)・固定費・ルール・削除をまとめて変えられる。
 */
export default async function CategoriesSettingsPage() {
  const genres = await listGenres();
  return (
    <div className="rise space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          カテゴリ
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          カテゴリを開くと、名前・アイコンと色・目標額・固定費などを変えられます。
        </p>
      </header>
      <CategoryList
        categories={genres.map((g) => ({ id: g.id, name: g.name, showOnHome: g.showOnHome }))}
      />
    </div>
  );
}
