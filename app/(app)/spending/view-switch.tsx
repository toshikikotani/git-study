'use client';

import { useEffect, useState } from 'react';

import { hapticFor } from '@/lib/haptics';
import { scrollToLedger, scrollToTop, LEDGER_ANCHOR } from '@/lib/scroll';

/**
 * 「概要 / 明細」の切り替え。明細を選ぶと明細の先頭まで一気に移動し(1タップ)、
 * 概要を選ぶと一番上へ戻る。今どちらを見ているかは、スクロール位置に追従する。
 * 画面の上部に固定する(スクロールしても届く)。
 */
export function ViewSwitch() {
  const [view, setView] = useState<'overview' | 'ledger'>('overview');

  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById(LEDGER_ANCHOR);
      if (el === null) return;
      setView(el.getBoundingClientRect().top < window.innerHeight * 0.4 ? 'ledger' : 'overview');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      role="tablist"
      aria-label="表示の切り替え"
      className="sticky z-20 flex gap-1 p-1"
      style={{
        top: 'calc(var(--sticky-top) + 8px)',
        borderRadius: 'var(--radius-full)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--hairline)',
      }}
    >
      {(
        [
          ['overview', '概要'],
          ['ledger', '明細'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={view === value}
          onClick={() => {
            setView(value);
            hapticFor('tabChange');
            if (value === 'ledger') scrollToLedger();
            else scrollToTop();
          }}
          className="min-h-11 flex-1 text-sm font-semibold"
          style={{
            borderRadius: 'var(--radius-full)',
            background: view === value ? 'var(--accent)' : 'transparent',
            color: view === value ? 'var(--on-accent)' : 'var(--ink-secondary)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
