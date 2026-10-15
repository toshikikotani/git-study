import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCategorySettings } from '@/features/category/settings-loader';
import { SettingsBody } from './settings-body';

export const dynamic = 'force-dynamic';

export default async function CategorySettingsPage({
  params,
}: {
  params: Promise<{ genreId: string }>;
}) {
  const { genreId } = await params;
  const data = await loadCategorySettings(genreId);
  if (data === null) notFound();
  return (
    <div className="rise space-y-4">
      <Link
        href="/settings/categories"
        className="inline-flex min-h-11 items-center text-sm font-semibold"
        style={{ color: 'var(--ink-secondary)' }}
      >
        ‹ カテゴリ
      </Link>
      <div
        className="glass rounded-[28px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <SettingsBody data={data} genreId={genreId} />
      </div>
    </div>
  );
}
