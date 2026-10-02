import { Skeleton } from '@/components/ui/skeleton';

/** 目標タブを押した直後に出す。集計が終わるまでタブを止めない。 */
export default function PlanLoading() {
  return (
    <div role="status" aria-label="目標を読み込み中" className="space-y-3">
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-36 rounded-3xl" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}
