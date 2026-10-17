import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listPendingReviewRecords } from '@/features/home/pending';
import { listOpenCaptures } from '@/features/receipt-captures/store';
import { CaptureRow } from './pending-receipt-rows';
import { PendingReviewRecords } from './pending-review-records';

/** 月・日・口座の絞り込みから独立した未処理の入口。通常の明細もそのまま残す。 */
export async function PendingReviewPage({ kind }: { kind: 'input' | 'category' }) {
  const captures = kind === 'input' ? await listOpenCaptures() : [];
  const records = kind === 'category' ? await listPendingReviewRecords() : [];
  if (kind === 'input' && captures.length === 1) {
    redirect(
      `/transactions/receipt/${captures[0]!.id}?returnTo=${encodeURIComponent('/spending?review=input')}`,
    );
  }
  const input = kind === 'input';
  return (
    <div className="rise flex flex-col gap-4" style={{ color: 'var(--ink)' }}>
      <Link
        href="/"
        className="flex min-h-11 items-center self-start text-[17px]"
        style={{ color: 'var(--accent)' }}
      >
        ‹ 今日
      </Link>
      <header className="px-1">
        <h1 className="text-[28px] font-bold">
          {input ? '入力待ちのレシート' : 'カテゴリの確認待ち'}
        </h1>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-muted)' }}>
          すべての月から{input ? captures.length : records.length}件。
          {input ? '画像を見ながら入力できます。' : '保存すると、次の確認待ちへ進みます。'}
        </p>
      </header>
      {input ? (
        captures.length === 0 ? (
          <p role="status" className="px-4 py-6 text-sm" style={{ color: 'var(--ink-muted)' }}>
            入力待ちのレシートはありません。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {captures.map((capture) => (
              <CaptureRow key={capture.id} capture={capture} returnTo="/spending?review=input" />
            ))}
          </ul>
        )
      ) : (
        <PendingReviewRecords records={records} />
      )}
      <Link
        href="/spending"
        className="flex min-h-11 items-center font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        明細をすべて見る →
      </Link>
    </div>
  );
}
