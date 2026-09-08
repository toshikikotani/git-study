import { Skeleton } from '@/components/ui/skeleton';

/** /debts への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function DebtsLoading() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          負債
        </h1>
      </header>

      <div className="space-y-3">
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
      </div>
    </div>
  );
}
