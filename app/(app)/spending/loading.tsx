import { Skeleton } from '@/components/ui/skeleton';

/** /spending への切り替え直後に出す。実際の画面と同じ並びの骨格を先に見せる。 */
export default function SpendingLoading() {
  return (
    <div role="status" aria-label="家計簿を読み込み中" className="space-y-3">
      <Skeleton className="mx-auto h-8 w-32" />
      <Skeleton className="h-44 rounded-3xl" />
      <Skeleton className="h-52" />
      <Skeleton className="h-40" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}
