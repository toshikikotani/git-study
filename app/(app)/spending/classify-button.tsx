'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { AiIcon } from '@/components/ui/nav-icons';

import { classifyGenresAction } from './classify-actions';
import { useSpendingMonth } from './spending-month-provider';

/** 1回の処理の上限ずつ、残りが無くなるまで続ける回数の上限(押したまま止まらないように)。 */
const MAX_ROUNDS = 10;

/**
 * 未分類の明細を AI でカテゴリに分ける(「確認が必要」の未分類から、ADR-127)。分けた結果は合計にすぐ
 * 入れず、「カテゴリの確認」に提案として出す(本人が確かめて保存する)。
 */
export function ClassifyButton() {
  const router = useRouter();
  const { reloadVisibleMonth } = useSpendingMonth();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    let total = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const result = await classifyGenresAction('all');
        if (result.error) {
          setMessage({ text: result.error, error: true });
          return;
        }
        total += result.classifiedCount;
        if (!result.hasMore || result.classifiedCount === 0) break;
      }
      setMessage({
        text:
          total > 0
            ? `${total}件にカテゴリの案をつけました。「カテゴリの確認」で確かめてください。`
            : 'AIで分けられる明細はありませんでした。',
        error: false,
      });
      router.refresh();
      reloadVisibleMonth();
    } catch {
      setMessage({ text: '通信に失敗しました。もう一度お試しください。', error: true });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold disabled:opacity-40"
        style={{ background: 'var(--plane)', color: 'var(--accent)' }}
      >
        {busy ? null : <AiIcon size={16} />}
        {busy ? 'AIが分けています…' : 'AIでカテゴリの案をつける'}
      </button>
      {message ? (
        <p
          role={message.error ? 'alert' : 'status'}
          className="px-1 text-[13px]"
          style={{ color: message.error ? 'var(--over)' : 'var(--ink-secondary)' }}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
