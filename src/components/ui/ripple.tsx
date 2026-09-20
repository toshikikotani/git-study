'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Material のリップル効果(ADR-027)。
 *
 * タップ位置から円が広がって消える、Material のタッチフィードバックの
 * 中核。`useRipple()` が返す `onPointerDown`/`ripples` を、押せる要素
 * (Button・Fab・Chip 等)側で `position: relative; overflow: hidden` の
 * コンテナに配置して使う。
 *
 * アニメーションが終わった円は state から取り除く(DOM に残さない —
 * 連打しても要素が増え続けない)。
 */
type RippleInstance = { id: number; x: string; y: string; size: string };

export function useRipple() {
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const nextId = useRef(0);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const x = `${event.clientX - rect.left}px`;
    const y = `${event.clientY - rect.top}px`;

    const id = nextId.current++;
    setRipples((prev) => [...prev, { id, x, y, size: `${size}px` }]);
  }, []);

  const onAnimationEnd = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const rippleElements = ripples.map((r) => (
    <span
      key={r.id}
      aria-hidden
      className="md-ripple"
      style={
        {
          '--ripple-x': r.x,
          '--ripple-y': r.y,
          '--ripple-size': r.size,
          marginLeft: `calc(-1 * ${r.size} / 2)`,
          marginTop: `calc(-1 * ${r.size} / 2)`,
        } as React.CSSProperties
      }
      onAnimationEnd={() => onAnimationEnd(r.id)}
    />
  ));

  return { onPointerDown, rippleElements };
}
