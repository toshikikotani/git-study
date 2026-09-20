/**
 * Material 3 の Assist/Filter Chip 相当(ADR-027)。
 *
 * 小さな状態表示・タグに使う。押せない表示専用のバッジと違い、Chip は
 * 常に「アウトラインの丸ピル」という同じ形を持つ(Material の統一性)。
 */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'error' | 'income';
}) {
  const style: Record<typeof tone, React.CSSProperties> = {
    neutral: { color: 'var(--md-on-surface-variant)', border: '1px solid var(--md-outline)' },
    primary: { color: 'var(--md-primary)', border: '1px solid var(--md-primary)' },
    error: { color: 'var(--md-error)', border: '1px solid var(--md-error)' },
    income: { color: 'var(--md-income)', border: '1px solid var(--md-income)' },
  };

  return (
    <span
      className="md-label-large inline-flex items-center gap-1 px-3 py-1 text-[12px]"
      style={{ borderRadius: 'var(--md-shape-sm)', ...style[tone] }}
    >
      {children}
    </span>
  );
}
