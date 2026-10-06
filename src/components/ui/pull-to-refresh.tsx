'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { MdRefresh } from 'react-icons/md';

/**
 * 画面を下に引っ張って最新化する(本人発案、ADR-029)。
 *
 * ── なぜ要るか ──────────────────────────────────────────────
 * 以前は画面へ戻るたび(タブ切り替え・戻るボタン)に毎回 loading.tsx の
 * スケルトンを出し、サーバーへ取り直していた(ADR-026)。本人から
 * 「一回読み込んだページはそのまま保存しておき、最新の情報を読み込みたい
 * 時は下側に引っ張ってローディング出して」と要望があり、next.config.ts の
 * `staleTimes.dynamic` を伸ばして revisit では前回の内容をそのまま出す方針に
 * 変えた。その代わり、明示的に最新化する手段としてこの pull-to-refresh を
 * app/(app)/layout.tsx に一度だけ差し込み、全画面に効かせる。
 *
 * ── なぜ router.refresh() を useTransition で包むか ────────────
 * `router.refresh()` は現在のルートの Server Component を再取得して
 * 差し替えるが、これを Transition の外で直接呼ぶと React が古い内容を
 * いったん隠して loading.tsx のフォールバックを出してしまう(instant
 * loading states の仕組みそのもの)。`startTransition` で包むことで
 * 「まだ表示されている内容はそのまま残し、新しい内容が来たら差し替える」
 * という Transition 本来の挙動になり、`isPending` を使って自前のインジ
 * ケータ(下の円)を出し続けられる。
 *
 * ── なぜ onTouchMove を React の合成イベントではなくネイティブの
 *     addEventListener で登録するか ─────────────────────────────
 * React は touchmove を passive なリスナーとして登録するため、JSX の
 * onTouchMove 内で preventDefault() を呼んでもブラウザ既定のスクロール/
 * バウンスは止まらない。ネイティブの addEventListener に
 * `{ passive: false }` を明示して初めて、引っ張っている間だけページの
 * バウンスを止められる。
 */
const PULL_THRESHOLD = 64;
const MAX_PULL = 96;
const RESISTANCE = 0.5;
const INDICATOR_SIZE = 44;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pullPx, setPullPx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const pullPxRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // 画面の最上部でだけ引っ張りを開始する(途中でのスクロールと混同しない)。
      startYRef.current = window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;
      const dy = (e.touches[0]?.clientY ?? startYRef.current) - startYRef.current;
      if (dy <= 0) {
        pullPxRef.current = 0;
        setPullPx(0);
        return;
      }
      // ここから先はページ自体のバウンスを止め、引っ張りの動きだけにする。
      e.preventDefault();
      const next = Math.min(dy * RESISTANCE, MAX_PULL);
      pullPxRef.current = next;
      setPullPx(next);
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      if (pullPxRef.current >= PULL_THRESHOLD) {
        startTransition(() => router.refresh());
      }
      pullPxRef.current = 0;
      setPullPx(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [router, startTransition]);

  const readyToRelease = pullPx >= PULL_THRESHOLD;
  const visible = pullPx > 0 || isPending;

  return (
    <div ref={containerRef} className="flex flex-1 flex-col">
      <div
        aria-hidden
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: isPending ? INDICATOR_SIZE : pullPx,
          transition:
            pullPx === 0 || isPending ? 'height var(--duration-medium) var(--ease-spring)' : 'none',
        }}
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center"
          style={{
            borderRadius: 'var(--radius-full)',
            background: 'var(--glass-tint)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow)',
            opacity: visible ? 1 : 0,
            transition: 'opacity var(--duration-fast) var(--ease-standard)',
          }}
        >
          <MdRefresh
            aria-hidden
            size={16}
            className={isPending ? 'ptr-spin' : ''}
            style={{
              color: 'var(--accent)',
              transform: isPending
                ? undefined
                : `rotate(${readyToRelease ? 180 : (pullPx / PULL_THRESHOLD) * 180}deg)`,
              transition: isPending
                ? undefined
                : 'transform var(--duration-fast) var(--ease-standard)',
            }}
          />
        </span>
      </div>
      {children}
    </div>
  );
}
