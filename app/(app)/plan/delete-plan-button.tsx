'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { deletePlanAction } from './actions';

/**
 * 目標の削除。調整の操作から離れた画面の最下部に置き、確認のダイアログを必ず挟む
 * (誤タップで目標が消えないようにする)。
 */
export function DeletePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 text-[13px] font-semibold"
        style={{ color: 'var(--over)' }}
      >
        この目標を削除する
      </button>
      <BottomSheet
        open={confirming}
        onClose={() => (busy ? undefined : setConfirming(false))}
        role="dialog"
      >
        <div className="space-y-3 px-4 pt-2 pb-4">
          <p className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
            この目標を削除しますか?
          </p>
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            目標の予算と期間が消えます。記録した明細は消えません。
          </p>
          {error ? (
            <p role="alert" className="text-[13px]" style={{ color: 'var(--over)' }}>
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold"
              style={{ background: 'var(--plane)', color: 'var(--ink)' }}
            >
              やめる
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await deletePlanAction(planId);
                setBusy(false);
                if (result.error !== null) setError(result.error);
                else {
                  setConfirming(false);
                  router.refresh();
                }
              }}
              className="min-h-11 flex-1 rounded-xl text-[15px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--over)', color: 'var(--on-accent)' }}
            >
              {busy ? '削除しています…' : '削除する'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
