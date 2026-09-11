import Link from 'next/link';

import { listCategoryOptions } from '@/features/classification/store';
import { ReviewQueue } from './review-queue';

/**
 * 確認待ちキュー(FR-12, M2-5)。
 *
 * ルール・AI のどちらでも分類できなかった明細を、本人が1タップで直す場所。
 * 直すたびに学習ルールが1件増え、同じ摘要の次の明細は AI を経由せず
 * ルールだけで分類されるようになる(features/classification/store.ts の
 * createLearnedRule())。
 */

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const categories = await listCategoryOptions();

  return (
    <div className="rise space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          確認待ち
        </h1>
        <Link href="/transactions" className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          明細へ戻る
        </Link>
      </header>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        カテゴリを選んで確定すると、同じ摘要の次の明細から自動で分類されます。
      </p>

      <ReviewQueue categories={categories} />
    </div>
  );
}
