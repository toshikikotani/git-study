import { Skeleton } from '@/components/ui/skeleton';

/** /spending/pile への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function PileLoading() {
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          ちりつも
        </h1>
      </header>
      <Skeleton className="h-32 rounded-3xl" />
      <Skeleton className="h-40" />
      <Skeleton className="h-24" />
    </div>
  );
}
