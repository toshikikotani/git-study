import { Skeleton } from '@/components/ui/skeleton';

/** /settings/gmail への切り替え直後に出す。データを待つあいだ画面を止めない。 */
export default function GmailSettingsLoading() {
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Gmail 自動取得
        </h1>
      </header>
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
    </div>
  );
}
