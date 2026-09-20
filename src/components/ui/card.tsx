/**
 * 面を持つカード(ADR-028、ADR-027の Material Card を置き換え)。
 *
 * 以前は取り込み・貼り付け・Gmail設定の3画面がそれぞれ同じスタイルを
 * インラインで書いていた。同じ見た目を1箇所に集約する。
 *
 * variant は3種:
 *   elevated(既定)  影で浮かせる。ページの主要なブロック
 *   filled           塗り面のみ。elevated ほど強調しない付随情報
 *   outlined         輪郭線のみ。フォームの入力枠など
 *
 * 本文中のカードはガラス素材にしない(ADR-028、Liquid Glass はナビゲーション
 * chrome にだけ使う方針。app/globals.css 参照)。不透明な塗り+Apple 的な
 * 角丸(20px)にとどめる。
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
    elevated: { background: 'var(--surface)', boxShadow: 'var(--shadow-1)' },
    filled: { background: 'var(--surface-fill)' },
    outlined: { background: 'var(--plane)', border: '1px solid var(--hairline)' },
  };

  return (
    <section
      className={`p-5 ${className ?? ''}`}
      style={{ borderRadius: 'var(--radius-lg)', ...variantStyle[variant] }}
    >
      {children}
    </section>
  );
}
