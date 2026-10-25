import { Skeleton } from '@/components/ui/skeleton';

/** /savings への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function SavingsLoading() {
  return (
    <div className="hm-page">
      <header className="hm-page__header">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          貯金
        </h1>
      </header>
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}
