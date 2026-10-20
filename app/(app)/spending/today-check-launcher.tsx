'use client';

import { useState } from 'react';

import { ChevronRightIcon } from '@/components/ui/nav-icons';
import { TodayCheckSheet } from './today-check';

/**
 * 今日の答え合わせの入口(デザイン v4-1、ADR-129)。今日の画面ではカード、「確認が必要」ではいちばん上の
 * 行。LINE の「1件ずつ見る」(`?check=today`)から来たときは、開いた瞬間にシートを出す。
 */
export function TodayCheckLauncher({
  count,
  variant,
  autoOpen = false,
}: {
  count: number;
  variant: 'today' | 'review';
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      {count > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-16 w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left"
          style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[17px] font-semibold">
              {variant === 'today' ? `今日の答え合わせ ${count}件` : '今日の分をまとめて確かめる'}
            </span>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {variant === 'today'
                ? '自動で入った記録を、スワイプで確かめるだけ'
                : `${count}件・合ってる/直す/数えないを1枚ずつ`}
            </span>
          </span>
          <span style={{ color: 'var(--ink-muted)' }}>
            <ChevronRightIcon />
          </span>
        </button>
      ) : null}
      <TodayCheckSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
