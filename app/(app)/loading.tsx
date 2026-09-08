import { Skeleton } from '@/components/ui/skeleton';

/** ホームへの切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function HomeLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[260px] rounded-[28px]" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-[132px] rounded-[22px]" />
        <Skeleton className="h-[132px] rounded-[22px]" />
      </div>
    </div>
  );
}
