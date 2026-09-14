import { Skeleton } from '@/components/ui/skeleton';

/** /side-hustle への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function SideHustleLoading() {
  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          副業トラッカー
        </h1>
      </header>
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}
