'use client';

import { useState } from 'react';

import { BottomSheet, BottomSheetHeader } from '@/components/ui/bottom-sheet';
import { ChevronRightIcon } from '@/components/ui/nav-icons';

export type DetailRow = {
  key: string;
  title: string;
  /** 行の2行目(固定費の「見込みに含めて計算」など)。 */
  sub?: string;
  /** 右の値。 */
  value?: string;
  /** 押すとシートで出す中身。 */
  content: React.ReactNode;
};

/**
 * くわしく(デザイン仕様書の「分析 › 目標」、ADR-091):なぜ約X円？・確率の分布・固定費の行。押すとその場で
 * シートを開く(画面を移らない)。
 */
export function DetailRows({ rows }: { rows: readonly DetailRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = rows.find((r) => r.key === open) ?? null;
  return (
    <>
      <div className="flex flex-col rounded-2xl" style={{ background: 'var(--surface)' }}>
        {rows.map((r, i) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setOpen(r.key)}
            className="flex min-h-13 items-center gap-3 px-4 text-left"
            style={{
              color: 'var(--ink)',
              borderTop: i > 0 ? '1px solid var(--hairline)' : undefined,
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col py-2">
              <span className="text-[16px]">{r.title}</span>
              {r.sub ? (
                <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                  {r.sub}
                </span>
              ) : null}
            </span>
            {r.value ? (
              <span className="tabular shrink-0 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {r.value}
              </span>
            ) : null}
            <span style={{ color: 'var(--ideal)' }}>
              <ChevronRightIcon />
            </span>
          </button>
        ))}
      </div>
      <BottomSheet
        open={current !== null}
        onClose={() => setOpen(null)}
        label={current?.title ?? 'くわしく'}
        tall
      >
        {current ? (
          <div className="flex flex-col gap-3 pb-6">
            <BottomSheetHeader className="grid grid-cols-[1fr_auto_1fr] items-center pt-1">
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="flex min-h-11 items-center justify-self-start text-[17px]"
                style={{ color: 'var(--accent)' }}
              >
                閉じる
              </button>
              <span className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
                {current.title}
              </span>
              <span />
            </BottomSheetHeader>
            {current.content}
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
