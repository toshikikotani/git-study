import { Skeleton } from '@/components/ui/skeleton';

/** /transactions への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function TransactionsLoading() {
  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          明細
        </h1>
      </header>
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
