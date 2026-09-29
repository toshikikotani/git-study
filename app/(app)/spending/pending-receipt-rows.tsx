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
  const { captures } = useSpendingMonth();

  // サーバー側の入力待ちに載った分は、撮影直後の仮の行を重ねて出さない。
  const shownJobs = jobs.filter(
    (j) => !(j.status === 'needs_input' && captures.some((c) => c.id === j.captureId)),
  );
  if (shownJobs.length === 0 && captures.length === 0) return null;

  return (
    <ul
      aria-label="読み取り中・入力待ちのレシート"
      className="divide-y overflow-hidden rounded-2xl"
      style={{
        background: 'var(--surface)',
        boxShadow: 'var(--card-shadow)',
        borderColor: 'var(--hairline)',
      }}
    >
      {captures.map((c) => (
        <CaptureRow key={c.id} capture={c} />
      ))}
      {shownJobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </ul>
  );
}

const ROW = 'flex min-h-14 items-center gap-3 px-4 py-3';

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-10 rounded-lg object-cover" />
  ) : (
    <span aria-hidden className="size-10 rounded-lg" style={{ background: 'var(--hairline)' }} />
  );
}

/** 入力待ち(サーバーに残っているもの)。 */
function CaptureRow({ capture }: { capture: CaptureView }) {
  const [, m, d] = capture.capturedOn.split('-');
  return (
    <li>
      <Link
        href={`/transactions/receipt/${capture.id}` as Route}
        prefetch={false}
        className={ROW}
        aria-label={`入力待ちのレシート、${Number(m)}月${Number(d)}日に撮影。タップして入力する`}
      >
        <Thumb src={capture.imageUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
            入力待ち
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-[13px] font-semibold"
              style={{ background: 'var(--attention-track)', color: 'var(--ink)' }}
            >
              <span aria-hidden>▲ </span>集計に未反映
            </span>
          </p>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            {capture.receiptStatus === 'partial'
              ? '一部だけ読み取れました。残りを入力してください'
              : '読み取れませんでした。画像を見て入力できます'}
          </p>
        </div>
        <span className="shrink-0 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
          入力する →
        </span>
      </Link>
    </li>
  );
}

/** 撮影直後の仮の行。 */
function JobRow({ job }: { job: ReceiptJob }) {
  const href: Route =
    job.status === 'needs_input' && job.captureId
      ? (`/transactions/receipt/${job.captureId}` as Route)
      : '/transactions/receipt';
  return (
    <li>
      <Link href={href} prefetch={false} className={ROW}>
        <Thumb src={job.previewUrl} />
        <div className="min-w-0 flex-1">
          {job.status === 'reading' ? (
            <>
              <div
                className="h-3.5 w-1/2 animate-pulse rounded"
                style={{ background: 'var(--hairline)' }}
              />
              <p className="mt-1.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                読み取り中…
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-[15px]" style={{ color: 'var(--ink)' }}>
                {job.status === 'ready'
                  ? (job.parsed[0]?.storeName ?? job.parsed[0]?.description ?? 'レシート')
                  : job.status === 'waiting'
                    ? '読み取り待ち'
                    : job.status === 'needs_input'
                      ? '入力待ち'
                      : 'レシート'}
              </p>
              <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
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
        <span className="shrink-0 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
          {job.status === 'reading' || job.status === 'waiting'
            ? ''
            : job.status === 'needs_input'
              ? '入力する →'
              : '確認 →'}
        </span>
      </Link>
    </li>
  );
}
