import { Skeleton } from '@/components/ui/skeleton';

/** /reports への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function ReportsLoading() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          支出レポート
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          収支・カテゴリ別支出・店舗別支出・資産推移
        </p>
      </header>
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-40" />
    </div>
  );
}
