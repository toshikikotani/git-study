import { Skeleton } from '@/components/ui/skeleton';

/** /settings/rescued-emails への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function RescuedEmailsLoading() {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          AI救済メールの見直し
        </h1>
      </header>
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}
