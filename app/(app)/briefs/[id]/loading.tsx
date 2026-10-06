import { Skeleton } from '@/components/ui/skeleton';

/**
 * /briefs/[id] への切り替え直後に出す。タイトル(配信日)自体がデータなので
 * ここでは文字を出せない。代わりにタイトルの位置にも骨格を置く
 * (「遷移した」ことが即座に伝わることを優先する)。
 */
export default function BriefDetailLoading() {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <Skeleton className="h-7 w-32" />
      </header>
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}
