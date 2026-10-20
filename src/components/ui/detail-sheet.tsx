'use client';

import { useState } from 'react';

import { BottomSheet, BottomSheetHeader } from './bottom-sheet';

/**
 * カードの「くわしく」や設定の行から開くシート(提案書「分析を浅くする」「設定は1画面」、ADR-127)。
 * 中身はサーバーで描いたものを children で受け取る(画面を移らずに、くわしい内容を下から出す)。
 */
export function DetailSheet({
  label,
  sub,
  row = false,
  title,
  children,
}: {
  /** カードに出すボタンの文字。 */
  label: string;
  /** 行の形のとき、名前の下に出す補足。 */
  sub?: string;
  /** 設定の一覧の行の形で出す(ふだんはカードの中の文字のボタン)。 */
  row?: boolean;
  /** シートの見出し。 */
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {row ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
          style={{ color: 'var(--ink)' }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-medium">{label}</span>
            {sub ? (
              <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {sub}
              </span>
            ) : null}
          </span>
          <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
            ›
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 items-center text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {label}
        </button>
      )}
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
