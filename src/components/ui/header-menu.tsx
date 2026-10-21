'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export type HeaderMenuItem =
  | { label: string; onSelect: () => void; href?: undefined }
  | { label: string; href: string; onSelect?: undefined };

/**
 * 右上の「…」(デザインの課題 #8、ADR-131)。画面の上部の操作が3つ以上になったら、戻る・タイトルと同じ
 * 1段に「…」を1つだけ置き、押すと小さなメニューで出す。外を押す・Esc で閉じる。
 */
export function HeaderMenu({ label, items }: { label: string; items: readonly HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const itemClass = 'w-full items-center rounded-xl px-3 text-left text-[15px] font-semibold';
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-11 items-center justify-center rounded-full"
        style={{ color: 'var(--accent)' }}
      >
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-40 mt-1 w-56 rounded-2xl border p-2 shadow-lg"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--hairline)',
            color: 'var(--ink)',
          }}
        >
          {items.map((item) =>
            item.href !== undefined ? (
              <Link
                key={item.label}
                role="menuitem"
                href={item.href as Route}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 ${itemClass}`}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex min-h-11 ${itemClass}`}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
