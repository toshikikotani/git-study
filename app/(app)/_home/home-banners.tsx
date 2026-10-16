import Link from 'next/link';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { countNeedsInputCaptures, countPendingReview } from '@/features/home/pending';

/**
 * ホームの上の知らせ(デザイン仕様書の「レシート1件が入力待ち」、ADR-090)。押すと明細へ。
 * 確認待ちの記録(自動の分類で確かめが要るもの)も同じ形で出す。どちらも無ければ何も出さない。
 */
export async function HomeBanners() {
  const [captures, pending] = await Promise.all([countNeedsInputCaptures(), countPendingReview()]);
  if (captures === 0 && pending === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {captures > 0 ? (
        <Banner
          title={`レシート${captures}件が入力待ち`}
          detail="読み取れなかったので、画像を見て入力できます"
          icon={
            <>
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
              <path d="M9 8h6M9 12h6" />
            </>
          }
        />
      ) : null}
      {pending > 0 ? (
        <Banner
          title={`確認待ちの記録が${pending}件`}
          detail="自動で分けたカテゴリを確かめられます"
          icon={<path d="M5 12l5 5L20 7" />}
        />
      ) : null}
    </div>
  );
}

function Banner({ title, detail, icon }: { title: string; detail: string; icon: React.ReactNode }) {
  return (
    <Link
      href="/spending"
      className="flex min-h-11 items-center gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: 'var(--state-caution-track)', color: 'var(--caution-mark)' }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          {detail}
        </span>
      </span>
      <span style={{ color: 'var(--ideal)' }}>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
