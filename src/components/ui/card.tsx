/**
 * 面を持つカード(Material 3 Card、ADR-027)。
 *
 * 以前は取り込み・貼り付け・Gmail設定の3画面がそれぞれ同じスタイルを
 * インラインで書いていた。同じ見た目を1箇所に集約する。
 *
 * variant は Material 3 の3種:
 *   elevated(既定)  影で浮かせる。ページの主要なブロック
 *   filled           塗り面のみ。elevated ほど強調しない付随情報
 *   outlined         輪郭線のみ。フォームの入力枠など
 */
export function Card({
  children,
  className,
  variant = 'elevated',
}: {
  children: React.ReactNode;
  className?: string;
  variant?: 'elevated' | 'filled' | 'outlined';
}) {
  const variantStyle: Record<typeof variant, React.CSSProperties> = {
    elevated: { background: 'var(--md-surface-container-low)', boxShadow: 'var(--md-elevation-1)' },
    filled: { background: 'var(--md-surface-container-high)' },
    outlined: { background: 'var(--md-surface)', border: '1px solid var(--md-outline-variant)' },
  };

  return (
    <section
      className={`p-5 ${className ?? ''}`}
      style={{ borderRadius: 'var(--md-shape-lg)', ...variantStyle[variant] }}
    >
      {children}
    </section>
  );
}
