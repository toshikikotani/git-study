'use client';

import { useState } from 'react';

import { BottomSheet, BottomSheetHeader } from './bottom-sheet';

/**
 * カードの「くわしく」から開くシート(提案書「分析を浅くする」、ADR-127)。中身はサーバーで描いた
 * ものを children で受け取る(画面を移らずに、くわしい内容を下から出す)。
 */
export function DetailSheet({
  label,
  title,
  children,
}: {
  /** カードに出すボタンの文字。 */
  label: string;
  /** シートの見出し。 */
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center text-[15px] font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        {label}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label={title} tall>
        <BottomSheetHeader className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 px-2 text-sm font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            閉じる
          </button>
        </BottomSheetHeader>
        <div className="flex flex-col gap-3 pb-6">{children}</div>
      </BottomSheet>
    </>
  );
}
