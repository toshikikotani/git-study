/**
 * 「10回中○回」を10個の点で見せる(デザインの見込みのカード)。塗った点と点線の枠で
 * 区別するので、色だけに頼らない。読み上げは横の「10回中○回」の文字に任せる。
 */
export function TenDots({
  probability,
  color = 'var(--action)',
  ring = 'var(--ink-muted)',
  size = 'md',
}: {
  /** 0〜1。10回中の回数に丸める。 */
  probability: number;
  color?: string;
  /** 塗らない点の点線の色(濃い面の上では明るい色に)。 */
  ring?: string;
  size?: 'sm' | 'md';
}) {
  const filled = Math.min(10, Math.max(0, Math.round(probability * 10)));
  const dot = size === 'sm' ? 'size-2' : 'size-3';
  return (
    <span aria-hidden className="flex shrink-0 gap-1">
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          data-dot={i < filled ? 'on' : 'off'}
          className={`${dot} rounded-full`}
          style={
            i < filled
              ? { background: color }
              : { border: `1.5px dashed ${ring}`, boxSizing: 'border-box' }
          }
        />
      ))}
    </span>
  );
}
