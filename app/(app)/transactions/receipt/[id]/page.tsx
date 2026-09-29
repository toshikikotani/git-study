import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listAccounts } from '@/features/accounts/store';
import { listGenres } from '@/features/genre/store';
import { getCapture } from '@/features/receipt-captures/store';
import { todayJst } from '@/lib/date';
import { createClient } from '@/lib/supabase/server';
import { CaptureEntry } from './capture-entry';

/** 最近の店(候補)。入力の手間を減らすため、直近の明細の店名を重複なく並べる。 */
async function recentStoreNames(limit = 8): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('transactions')
    .select('merchant_name')
    .not('merchant_name', 'is', null)
    .order('occurred_on', { ascending: false })
    .limit(80);
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (row.merchant_name && !seen.has(row.merchant_name)) seen.add(row.merchant_name);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/**
 * 入力待ちのレシート(読み取れなかった/一部だけ読めた)を手で入力する画面(F7)。
 * 画像とフォームを同じ画面に置き、見ながら 金額 → 日付 → 店名 → ジャンル と入力する。
 */
export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
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
        <h1 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          レシートを入力
        </h1>
        <Link href="/spending" className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          家計簿へ →
        </Link>
      </header>
      {capture.status === 'resolved' ? (
        <p className="py-8 text-center text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
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
