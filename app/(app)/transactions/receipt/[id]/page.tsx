import { ScreenFrame } from '../../../screen-frame';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { recentStoreNames } from '@/features/transactions/recent-stores';
import { getCapture } from '@/features/receipt-captures/store';
import { todayJst } from '@/lib/date';
import { CaptureEntry } from './capture-entry';

/**
 * 入力待ちのレシート(読み取れなかった/一部だけ読めた)を手で入力する画面(F7)。
 * 画像とフォームを同じ画面に置き、見ながら 金額 → 日付 → 店名 → ジャンル と入力する。
 */
export default function CapturePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ScreenFrame title="レシート" />}>
      <CapturePageBody {...props} />
    </Suspense>
  );
}

async function CapturePageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const capture = await getCapture(id);
  if (capture === null) notFound();
  const [genres, accounts, recentStores] = await Promise.all([
    listGenres(),
    listAccounts(),
    recentStoreNames(),
  ]);

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          レシートを入力
        </h1>
        <Link
          href="/spending"
          className="min-h-11 inline-flex items-center text-xs"
          style={{ color: 'var(--ink-secondary)' }}
        >
          家計簿へ →
        </Link>
      </header>
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
        />
      )}
    </div>
  );
}
