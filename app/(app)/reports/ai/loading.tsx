import { Skeleton } from '@/components/ui/skeleton';

/** /reports/ai への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function AiReportLoading() {
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AIレポート
        </h1>
      </header>
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-40" />
    </div>
  );
}
