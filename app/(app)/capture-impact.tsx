'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { freeAfterReceipt, receiptTotalYen } from '@/domain/receipt-impact';
import { formatYen } from '@/domain/money';
import type { ReceiptJob } from '@/features/import/receipt-queue';
import { freeRemainingAction } from '@/app/(app)/transactions/receipt/free-remaining-action';

/** 撮ったその場の結果。読めた額は自由残から引き、読めなければその一枚だけを残す。 */
export function CaptureImpact({ job }: { job: ReceiptJob }) {
  const [free, setFree] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void freeRemainingAction().then((value) => {
      if (!cancelled) setFree(value);
    });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const read =
    job.status === 'ready' ? receiptTotalYen(job.parsed.map((row) => row.amountYen)) : null;
  const after = free != null && read != null ? freeAfterReceipt(free, read) : null;

  return (
    <div
      role="status"
      className="w-full rounded-2xl px-4 py-3 text-sm"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--glass-border)',
        color: 'var(--ink)',
      }}
    >
      {job.status === 'needs_input' || job.status === 'error' ? (
        <p>読めませんでした。この一枚だけ入力待ちです。</p>
      ) : (
        <p className="tabular">
          読めた {read === null ? '…' : formatYen(read)}。
          {after === null
            ? '自由残は目標を入れると出ます。'
            : `自由残 ${formatYen(free ?? 0)} から ${formatYen(after)}。`}
          実績にはまだ入っていません。
        </p>
      )}
      <Link
        href={job.captureId ? `/transactions/receipt/${job.captureId}` : '/transactions/receipt'}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        その場で直す
      </Link>
    </div>
  );
}
