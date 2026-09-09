import { Skeleton } from '@/components/ui/skeleton';

/** /accounts への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function AccountsLoading() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          口座
        </h1>
      </header>

      <div className="space-y-3">
        <Skeleton className="h-[92px]" />
        <Skeleton className="h-[92px]" />
      </div>
    </div>
  );
}
