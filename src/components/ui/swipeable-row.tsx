'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 明細行の左フリック・長押し(本人発案「左フリックで編集とか長押ししたら
 * レシートの内容を見れるとか、直感的な操作を増やしたい」)。
 *
 * pull-to-refresh.tsx と同じ理由で、`preventDefault()` が効くネイティブの
 * `addEventListener({ passive: false })` を使う(React の合成 touchmove は
 * passive 登録のため、JSX の onTouchMove 内で止めようとしても効かない)。
 *
 * ── スワイプ・長押し・タップの見分け方 ──────────────────────────
 * touchstart の時点では、この後どれになるか分からない。指の動きがほぼ
 * 横方向かつ一定量を超えたら「左フリック」、ほとんど動かないまま
 * LONG_PRESS_MS 経過したら「長押し」、それ以外(小さく動いただけ、または
 * 縦方向)はブラウザ標準の「タップ」に任せる——タップの処理はこの
 * コンポーネントでは一切行わず、中身の `<button onClick>` がそのまま効く。
 *
 * 長押しが発火した後に触れを離す(touchend)と、そのままではブラウザが
 * 合成の click を発行し「タップして行が開く」動作まで起きてしまうため、
 * `e.preventDefault()` でそれだけを止める。
 *
 * ── ref と state の使い分け(pull-to-refresh.tsx と同じ理由) ────────
 * touchmove ハンドラは effect が登録された時点の state しか見えない
 * (クロージャが古いまま)ため、判定に使う「今どれだけ動いたか」は
 * `dragPxRef` に持たせ、見た目の再描画にだけ `dragPx` state を使う。
 */
const SWIPE_THRESHOLD = 56;
const MAX_REVEAL = 72;
const LONG_PRESS_MS = 500;
const MOVE_SLOP = 10;

type Mode = 'unknown' | 'swipe' | 'longpress' | 'scroll';

export function SwipeableRow({
  /** 閾値を超えて左フリックした時に呼ぶ(例:カテゴリ編集を直接開く)。 */
  onSwipeLeft,
  /** ほぼ動かさずに長押しした時に呼ぶ(例:内容をその場でプレビュー)。 */
  onLongPress,
  children,
}: {
  onSwipeLeft?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragPx, setDragPx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const dragPxRef = useRef(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef<Mode>('unknown');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
    const resetDrag = () => {
      dragPxRef.current = 0;
      setDragPx(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      modeRef.current = 'unknown';
      longPressFiredRef.current = false;
      setAnimating(false);
      longPressTimerRef.current = setTimeout(() => {
        if (modeRef.current !== 'unknown') return;
        modeRef.current = 'longpress';
        longPressFiredRef.current = true;
        onLongPress?.();
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const start = startRef.current;
      const touch = e.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (modeRef.current === 'unknown') {
        if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
        // ここまで動いたら長押しの候補では無くなる(スワイプか、縦スクロール)。
        clearLongPressTimer();
        modeRef.current = dx < 0 && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
      }
      if (modeRef.current !== 'swipe') return;

      // ページの横方向のバウンス等を止め、フリックの動きだけにする。
      e.preventDefault();
      const next = Math.min(Math.max(-dx, 0), MAX_REVEAL);
      dragPxRef.current = next;
      setDragPx(next);
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPressTimer();
      if (longPressFiredRef.current) {
        // 長押し直後の合成 click(=タップして行が開く)を止める。
        e.preventDefault();
      }
      if (modeRef.current === 'swipe') {
        setAnimating(true);
        if (dragPxRef.current >= SWIPE_THRESHOLD) onSwipeLeft?.();
        resetDrag();
      }
      startRef.current = null;
      modeRef.current = 'unknown';
    };

    const onTouchCancel = () => {
      clearLongPressTimer();
      setAnimating(true);
      resetDrag();
      startRef.current = null;
      modeRef.current = 'unknown';
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      clearLongPressTimer();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [onSwipeLeft, onLongPress]);

  return (
    <div ref={containerRef} className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {/* 左フリックで裏から見える「編集」の合図。実際に画面遷移するのは
          onSwipeLeft 側(呼び出し元がカテゴリ編集を直接開く)。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4"
        style={{ width: MAX_REVEAL, opacity: dragPx / MAX_REVEAL, color: 'var(--accent)' }}
      >
        <span className="text-xs font-semibold">編集</span>
      </div>
      <div
        style={{
          transform: `translateX(${-dragPx}px)`,
          transition: animating ? 'transform var(--duration-medium) var(--ease-spring)' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
