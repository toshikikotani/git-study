'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MdMoreHoriz } from 'react-icons/md';

import { BottomSheet } from '@/components/ui/bottom-sheet';

const ITEMS = [
  { href: '/transactions/import', label: '取り込む', hint: 'CSV・メールの貼り付け' },
  { href: '/transactions/reconcile', label: '突き合わせ', hint: 'カード明細との照合' },
  { href: '/accounts', label: '口座', hint: '口座の追加・編集' },
] as const;

/** 明細の見出し右側の操作(口座・突き合わせ・取り込む)を1つの「…」メニューにまとめる。 */
export function LedgerMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="明細のメニュー"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex size-11 items-center justify-center rounded-full"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <MdMoreHoriz aria-hidden size={24} />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} role="menu">
        <ul className="px-2 pb-2">
          {ITEMS.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                prefetch={false}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-baseline justify-between gap-3 px-2 py-2"
                style={{ color: 'var(--ink)' }}
              >
                <span className="text-base font-semibold">{i.label}</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {i.hint} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
