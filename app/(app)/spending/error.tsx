'use client';

import { useEffect } from 'react';
import { MdErrorOutline } from 'react-icons/md';

import { Button } from '@/components/ui/button';
import { ErrorDetail } from '@/components/ui/error-detail';

/** 家計簿の読み込みエラー。ほかのタブには波及させず、この画面だけやり直せる。 */
export default function SpendingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <MdErrorOutline aria-hidden size={40} style={{ color: 'var(--over)' }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          家計簿を読み込めませんでした
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          記録は消えていません。通信を確認して、もう一度お試しください。
        </p>
      </div>
      <ErrorDetail error={error} />
      <Button onClick={reset} variant="filled" className="mt-1">
        もう一度試す
      </Button>
    </div>
  );
}
