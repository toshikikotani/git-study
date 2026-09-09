import { Skeleton } from '@/components/ui/skeleton';

/** /investments への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function InvestmentsLoading() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          投資
        </h1>
      </header>

      <Skeleton className="h-[160px]" />
    </div>
  );
}
