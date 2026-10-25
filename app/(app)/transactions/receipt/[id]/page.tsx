import { notFound } from 'next/navigation';

import { BackHeader } from '@/components/ui/back-header';
import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { recentStoreNames } from '@/features/transactions/recent-stores';
import { getCapture } from '@/features/receipt-captures/store';
import { todayJst } from '@/lib/date';
import { captureReturnTarget } from '@/features/receipt-captures/navigation';
import { CaptureEntry } from './capture-entry';

/**
 * 入力待ちのレシート(読み取れなかった/一部だけ読めた)を手で入力する画面(F7)。
 * 画像とフォームを同じ画面に置き、見ながら 金額 → 日付 → 店名 → ジャンル と入力する。
 */
export default async function CapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const target = captureReturnTarget((await searchParams)?.returnTo);
  const capture = await getCapture(id);
  if (capture === null) notFound();
  const [genres, accounts, recentStores] = await Promise.all([
    listGenres(),
    listAccounts(),
    recentStoreNames(),
  ]);

  return (
    <div className="rise hm-page space-y-4">
      <BackHeader back={target} title="レシートを入力" />
      {capture.status === 'resolved' ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
          このレシートは保存済みです。
        </p>
      ) : (
        <CaptureEntry
          capture={capture}
          genres={genres.map((g) => ({ id: g.id, name: g.name }))}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          recentStores={recentStores}
          today={todayJst()}
          returnTo={target.href}
        />
      )}
    </div>
  );
}
