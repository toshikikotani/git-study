'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 明細行のスワイプ・長押し(本人発案「左フリックで編集とか長押ししたら
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
const ACTIONS_WIDTH = 144;
const MAX_RIGHT = 88;
const LONG_PRESS_MS = 500;
const MOVE_SLOP = 10;

type Mode = 'unknown' | 'swipe' | 'longpress' | 'scroll';

/**
 * 明細行のスワイプ(本人発案の直感操作を、家計簿の明細リスト用に組み直した)。
 *   - 右へスワイプ → ジャンル変更(onSwipeRight)。しきい値を超えたら呼ぶ。
 *   - 左へスワイプ → 裏の操作(actions:削除・複製など)が現れ、開いたまま止まる。
 *     行のほかの場所を触るか、操作を選ぶと閉じる。
 *   - 長押し → その場のプレビュー(onLongPress)
 * タップは中身の button に任せる(ここでは処理しない)。
 */
export function SwipeableRow({
  onSwipeRight,
  onLongPress,
  actions,
  rightLabel = 'ジャンル',
  children,
}: {
  onSwipeRight?: () => void;
  onLongPress?: () => void;
  /** 左スワイプで現れる操作(ボタンの並び)。幅は 144px。 */
  actions?: React.ReactNode;
  rightLabel?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 見た目の位置(px。左が負、右が正)。
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const offsetRef = useRef(0);
  const revealedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; base: number } | null>(null);
  const modeRef = useRef<Mode>('unknown');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const hasActions = actions !== undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
    const move = (px: number) => {
      offsetRef.current = px;
      setOffset(px);
    };
    const setOpen = (open: boolean) => {
      revealedRef.current = open;
      setRevealed(open);
      setAnimating(true);
      move(open ? -ACTIONS_WIDTH : 0);
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        base: revealedRef.current ? -ACTIONS_WIDTH : 0,
      };
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
        clearLongPressTimer();
        modeRef.current = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
      }
      if (modeRef.current !== 'swipe') return;

      e.preventDefault();
      const min = hasActions ? -ACTIONS_WIDTH : 0;
      const max = onSwipeRight ? MAX_RIGHT : 0;
      move(Math.min(Math.max(start.base + dx, min), max));
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPressTimer();
      if (longPressFiredRef.current) e.preventDefault();
      if (modeRef.current === 'swipe') {
        const px = offsetRef.current;
        if (px >= SWIPE_THRESHOLD) {
          setAnimating(true);
          move(0);
          revealedRef.current = false;
          setRevealed(false);
          onSwipeRight?.();
        } else if (hasActions && px <= -SWIPE_THRESHOLD) {
          setOpen(true);
        } else {
          setOpen(false);
        }
      } else if (modeRef.current === 'unknown' && revealedRef.current) {
        // 開いている間のタップは、行を開かずに閉じるだけ。
        e.preventDefault();
        setOpen(false);
      }
      startRef.current = null;
      modeRef.current = 'unknown';
    };

    const onTouchCancel = () => {
      clearLongPressTimer();
      setOpen(revealedRef.current);
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
  }, [onSwipeRight, onLongPress, hasActions]);

  const close = () => {
    revealedRef.current = false;
    offsetRef.current = 0;
    setRevealed(false);
    setAnimating(true);
    setOffset(0);
  };

  return (
    <div ref={containerRef} className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {onSwipeRight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4"
          style={{
            width: MAX_RIGHT,
            opacity: Math.min(Math.max(offset, 0) / MAX_RIGHT, 1),
            color: 'var(--accent)',
          }}
        >
          <span className="text-xs font-semibold">{rightLabel}</span>
        </div>
      ) : null}
      {hasActions ? (
        <div
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{
            width: ACTIONS_WIDTH,
            visibility: offset < 0 || revealed ? 'visible' : 'hidden',
          }}
          onClick={close}
        >
          {actions}
        </div>
      ) : null}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? 'transform var(--duration-medium) var(--ease-spring)' : 'none',
          background: 'var(--surface)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
