'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { hapticFor } from '@/lib/haptics';
import { scrollToLedger, scrollToTop, LEDGER_ANCHOR } from '@/lib/scroll';

/**
 * 「概要 / 明細 / レポート」の切り替え(N4で3つ目を追加)。概要・明細は
 * この画面内のスクロール位置と連動する(明細を選ぶと明細の先頭まで一気に
 * 移動し、概要を選ぶと一番上へ戻る。今どちらを見ているかはスクロール位置に
 * 追従する)。レポートは別画面(/reports)のため、見た目だけ同じタブ列に
 * 揃えた通常のナビゲーションリンクにする(押しても「選択状態」にはならない
 * ——遷移後は /reports 自身の見出しがそれを表す)。
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
      <Link
        href="/reports"
        role="tab"
        aria-selected={false}
        onClick={() => hapticFor('tabChange')}
        className="min-h-11 flex flex-1 items-center justify-center text-sm font-semibold"
        style={{
          borderRadius: 'var(--radius-full)',
          background: 'transparent',
          color: 'var(--ink-secondary)',
        }}
      >
        レポート
      </Link>
    </div>
  );
}
