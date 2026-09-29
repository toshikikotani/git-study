import { Skeleton } from '@/components/ui/skeleton';

/**
 * カテゴリ詳細の読み込み中。共有要素の遷移が始まっているので、速く読み込めたときに骨格が
 * ちらつかないよう、150ms を過ぎるまでは何も出さない(`.skeleton-delayed`)。
 */
export default function CategoryLoading() {
  return (
    <div role="status" aria-label="カテゴリを読み込み中" className="skeleton-delayed space-y-3">
      <Skeleton className="h-24" />
      <Skeleton className="h-28" />
      <Skeleton className="h-44" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}
