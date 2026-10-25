import { Skeleton } from '@/components/ui/skeleton';

/** /briefs への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function BriefsLoading() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          朝配信
        </h1>
      </header>
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}
