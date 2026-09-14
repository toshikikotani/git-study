import { Skeleton } from '@/components/ui/skeleton';

/** /transactions/duplicates への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function DuplicatesLoading() {
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          重複の確認
        </h1>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          同じ金額・近い日付で、別の経路から入った明細
        </p>
      </header>
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
