'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { useReceiptJobs, type ReceiptJob } from '@/features/import/receipt-queue';
import type { CaptureView } from '@/features/receipt-captures/types';
import { useSpendingMonth } from './spending-month-provider';

/**
 * 明細リストの先頭に出す、まだ明細になっていないレシート。
 *   読み取り中   … 撮影直後の仮の行(撮影をブロックしない)
 *   確認待ち     … 読み取れた。確認して保存する
 *   読み取り待ち … 圏外で撮った。失敗ではなく、戻れば自動で読み取る
 *   入力待ち     … 読み取れなかった/一部だけ読めた。画像を見ながら手で入力する
 *                  (家計簿の集計・目標には入っていない)
 * 入力待ちは画像を残してあり、画面を開き直しても残る(サーバーの receipt_captures)。
 */
export function PendingReceiptRows() {
  const jobs = useReceiptJobs();
  const { captures, filter } = useSpendingMonth();
  // ほかの条件(日付・ジャンル・口座・期間)で絞っている間は、入力待ちは出さない。
  if (
    filter.date !== null ||
    filter.genreId !== null ||
    filter.accountId !== null ||
    filter.range !== null
  ) {
    return null;
  }

  // サーバー側の入力待ちに載った分は、撮影直後の仮の行を重ねて出さない。
  const shownJobs = jobs.filter(
    (j) => !(j.status === 'needs_input' && captures.some((c) => c.id === j.captureId)),
  );
  if (shownJobs.length === 0 && captures.length === 0) return null;

  return (
    <ul aria-label="読み取り中・入力待ちのレシート" className="flex flex-col gap-2">
      {captures.map((c) => (
        <CaptureRow key={c.id} capture={c} />
      ))}
      {shownJobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </ul>
  );
}

const ROW = 'flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3';
const ROW_STYLE = { background: 'var(--surface)', color: 'var(--ink)' } as const;

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-13 w-11 shrink-0 rounded-lg object-cover" />
  ) : (
    <span
      aria-hidden
      className="flex h-13 w-11 shrink-0 items-center justify-center rounded-lg"
      style={{ background: 'var(--note)', color: 'var(--ideal)' }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    </span>
  );
}

/** 右の小さな丸いボタン(「入力」「確認」)。 */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex min-h-9 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold"
      style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
    >
      {children}
    </span>
  );
}

/** 入力待ち(サーバーに残っているもの)。 */
export function CaptureRow({ capture, returnTo }: { capture: CaptureView; returnTo?: string }) {
  const [, m, d] = capture.capturedOn.split('-');
  return (
    <li>
      <Link
        href={
          `/transactions/receipt/${capture.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}` as Route
        }
        prefetch={false}
        className={`min-h-11 ${ROW}`}
        style={ROW_STYLE}
        aria-label={`入力待ちのレシート、${Number(m)}月${Number(d)}日に撮影。タップして入力する`}
      >
        <Thumb src={capture.imageUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[15px] font-semibold">入力待ちのレシート</p>
          <p className="text-[13px]" style={{ color: 'var(--state-caution)' }}>
            {capture.receiptStatus === 'partial'
              ? '一部だけ読み取れました。まだ集計に入っていません'
              : 'まだ集計に入っていません'}
          </p>
        </div>
        <Pill>入力</Pill>
      </Link>
    </li>
  );
}

/** 撮影直後の仮の行。 */
export function JobRow({ job }: { job: ReceiptJob }) {
  const href: Route =
    job.status === 'needs_input' && job.captureId
      ? (`/transactions/receipt/${job.captureId}` as Route)
      : '/transactions/receipt';
  return (
    <li>
      <Link href={href} prefetch={false} className={`min-h-11 ${ROW}`} style={ROW_STYLE}>
        <Thumb src={job.previewUrl} />
        <div className="min-w-0 flex-1">
          {job.status === 'reading' ? (
            <>
              <div
                className="h-4 w-1/2 animate-pulse rounded-lg"
                style={{ background: 'var(--hairline)' }}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                読み取り中…
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-[15px] font-semibold">
                {job.status === 'ready'
                  ? (job.parsed[0]?.storeName ?? job.parsed[0]?.description ?? 'レシート')
                  : job.status === 'waiting'
                    ? '読み取り待ち'
                    : job.status === 'needs_input'
                      ? '入力待ち'
                      : 'レシート'}
              </p>
              <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {job.status === 'ready'
                  ? '確認して保存する'
                  : job.status === 'waiting'
                    ? 'オンラインに戻ると自動で読み取ります'
                    : job.status === 'needs_input'
                      ? '読み取れませんでした。入力できます'
                      : '保存できませんでした。撮り直してください'}
              </p>
            </>
          )}
        </div>
        {job.status === 'reading' || job.status === 'waiting' ? null : (
          <Pill>{job.status === 'needs_input' ? '入力' : '確認'}</Pill>
        )}
      </Link>
    </li>
  );
}
