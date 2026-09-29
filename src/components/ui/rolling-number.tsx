'use client';

import { useEffect, useRef, useState } from 'react';

import { digitColumns, MOTION, prefersReducedMotion } from '@/lib/motion';

/**
 * 金額が変わったとき、数字が桁ごとに回転する表示(400ms)。
 * 「視差効果を減らす」ときは回転せず、クロスフェードにする。
 * 読み上げは aria-label に最終の金額を入れ、回転する桁は aria-hidden にする
 * (途中の数字が読み上げられない)。「円」は数字の0.7倍(.yen-unit)。
 */
export function RollingNumber({
  value,
  unit = true,
  className,
  style,
}: {
  value: number;
  /** 「円」を付ける。 */
  unit?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [shown, setShown] = useState<{ prev: number | null; next: number; tick: number }>({
    prev: null,
    next: value,
    tick: 0,
  });
  const last = useRef(value);

  useEffect(() => {
    if (last.current === value) return;
    const prev = last.current;
    last.current = value;
    setShown((s) => ({ prev, next: value, tick: s.tick + 1 }));
  }, [value]);

  const reduced = typeof window !== 'undefined' && prefersReducedMotion();
  const columns = digitColumns(shown.prev, shown.next);
  const label = `${value < 0 ? 'マイナス' : ''}${Math.abs(value).toLocaleString('ja-JP')}${unit ? '円' : ''}`;

  return (
    <span
      role="text"
      aria-label={label}
      className={`tabular inline-flex items-baseline ${className ?? ''}`}
      style={style}
    >
      {value < 0 ? <span aria-hidden>−</span> : null}
      {columns.map((c, i) =>
        c.kind === 'static' ? (
          <span key={`s${i}`} aria-hidden>
            {c.char}
          </span>
        ) : reduced ? (
          <span
            key={`d${i}-${shown.tick}`}
            aria-hidden
            className={c.changed ? 'motion-fade-in' : undefined}
          >
            {c.to}
          </span>
        ) : (
          <span
            key={`d${i}`}
            aria-hidden
            className="inline-block h-[1em] overflow-hidden leading-none"
            style={{ verticalAlign: 'bottom' }}
          >
            <span
              key={shown.tick}
              className={`flex flex-col ${c.changed ? 'digit-roll' : ''}`}
              style={
                {
                  '--digit-from': c.from,
                  '--digit-to': c.to,
                  animationDuration: `${MOTION.numberMs}ms`,
                  transform: `translateY(calc(var(--digit-to) * -1em))`,
                } as React.CSSProperties
              }
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="h-[1em] leading-none">
                  {n}
                </span>
              ))}
            </span>
          </span>
        ),
      )}
      {unit ? (
        <span aria-hidden className="yen-unit">
          円
        </span>
      ) : null}
    </span>
  );
}
