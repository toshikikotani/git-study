/**
 * 面を持つカード。`surface` 色 + `card-shadow` の組で、画面の基本単位。
 *
 * 以前は取り込み・貼り付け・Gmail設定の3画面がそれぞれ同じスタイルを
 * インラインで書いていた。同じ見た目を1箇所に集約する。
 */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl p-5 ${className ?? ''}`}
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {children}
    </section>
  );
}
