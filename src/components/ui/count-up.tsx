'use client';

import { useEffect, useRef } from 'react';

/**
 * 数字を 0 から目標値へ数え上げる。
 *
 * 完済カウントダウンは、開くたびに「まだこれだけある」ではなく
 * 「ここまで来た」と読ませたい。静止した数字より、立ち上がる数字の方が
 * 進行中であることが伝わる(FR-60:開く理由を作る)。
 *
 * ── state を持たない理由 ────────────────────────────────────
 * 最終値をそのまま描画し、アニメーションだけを ref 経由で当てる。
 *   - サーバ描画の時点で正しい数字が入る(JS が動かなくても読める)
 *   - 動きを減らす設定では何もしない。0 からの一瞬のちらつきが起きない
 *   - effect 内で同期的に setState しない
 * value が変われば React が再描画して最終値に戻すため、表示が壊れない。
 */
export function CountUp({
  value,
  durationMs = 900,
  className,
  style,
}: {
  value: number;
  durationMs?: number;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // 終盤で減速させる。数字が「着地」して見える
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(value * eased).toLocaleString('ja-JP');
      if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // 中断されても最終値に戻す
      el.textContent = value.toLocaleString('ja-JP');
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className} style={style}>
      {value.toLocaleString('ja-JP')}
    </span>
  );
}
