'use client';

import Link from 'next/link';

import { useReceiptJobs } from '@/features/import/receipt-queue';

/**
 * 撮影直後の「読み取り中」の仮の行(明細リストの先頭)。撮影をブロックせず、
 * 読み取りが終わると「確認する」に変わる。エラーは行に赤字を出さず、確認画面へ導く
 * (エラーの詳細は確認画面で見せる)。
 */
export function PendingReceiptRows() {
  const jobs = useReceiptJobs();
  if (jobs.length === 0) return null;

  return (
    <ul
      aria-label="読み取り中のレシート"
      className="divide-y overflow-hidden rounded-2xl"
      style={{
        background: 'var(--surface)',
        boxShadow: 'var(--card-shadow)',
        borderColor: 'var(--hairline)',
      }}
    >
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href="/transactions/receipt"
            prefetch={false}
            className="flex items-center gap-3 px-4 py-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={job.previewUrl} alt="" className="size-10 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              {job.status === 'reading' ? (
                <>
                  <div
                    className="h-3.5 w-1/2 animate-pulse rounded"
                    style={{ background: 'var(--hairline)' }}
                  />
                  <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    読み取り中…
                  </p>
                </>
              ) : (
                <>
                  <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
                    {job.status === 'ready'
                      ? (job.parsed[0]?.storeName ?? job.parsed[0]?.description ?? 'レシート')
                      : 'レシート'}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {job.status === 'ready' ? '確認して保存する' : '読み取れませんでした・確認する'}
                  </p>
                </>
              )}
            </div>
            <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              {job.status === 'reading' ? '' : '確認 →'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
