import { Skeleton } from '@/components/ui/skeleton';

/** /job-change への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function JobChangeLoading() {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          転職準備
        </h1>
      </header>
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
