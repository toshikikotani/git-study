import { Skeleton } from '@/components/ui/skeleton';

/** /advisor への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function AdvisorLoading() {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AI相談
        </h1>
      </header>
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}
