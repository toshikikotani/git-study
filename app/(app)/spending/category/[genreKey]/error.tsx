'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MdErrorOutline } from 'react-icons/md';

import { Button } from '@/components/ui/button';
import { ErrorDetail } from '@/components/ui/error-detail';
import { useOnline } from '@/features/category/a11y';

/** カテゴリ詳細の読み込み失敗。オフラインなら、その理由を言う。この画面だけやり直せる。 */
export default function CategoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const online = useOnline();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <MdErrorOutline aria-hidden size={40} style={{ color: 'var(--over)' }} />
      <div>
        <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          {online ? 'カテゴリを読み込めませんでした' : 'オフラインです'}
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          記録は消えていません。
          {online
            ? 'もう一度お試しください。'
            : '通信できるようになったら、もう一度お試しください。'}
        </p>
      </div>
      <ErrorDetail error={error} />
      <div className="flex gap-2">
        <Button onClick={reset} variant="filled">
          もう一度試す
        </Button>
        <Button onClick={() => router.back()} variant="tonal">
          戻る
        </Button>
      </div>
    </div>
  );
}
