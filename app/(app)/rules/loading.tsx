import { Skeleton } from '@/components/ui/skeleton';

/** /rules への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function RulesLoading() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          カテゴリと分類ルール
        </h1>
      </header>
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}
