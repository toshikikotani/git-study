/**
 * 状態表示・タグ用の小さなピル(ADR-028、ADR-027の Material Chip を置き換え)。
 *
 * 小さな状態表示・タグに使う。押せない表示専用のバッジと違い、Chip は
 * 常に「アウトラインの丸ピル」という同じ形を持つ(統一性のため)。
 */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'error' | 'income';
}) {
  const style: Record<typeof tone, React.CSSProperties> = {
    neutral: { color: 'var(--ink-secondary)', border: '1px solid var(--hairline)' },
    primary: { color: 'var(--accent)', border: '1px solid var(--accent)' },
    error: { color: 'var(--over)', border: '1px solid var(--over)' },
    income: { color: 'var(--income)', border: '1px solid var(--income)' },
  };

  return (
    <span
      className="label-text inline-flex items-center gap-1 px-3 py-1 text-[12px]"
      style={{ borderRadius: 'var(--radius-sm)', ...style[tone] }}
    >
      {children}
    </span>
  );
}
