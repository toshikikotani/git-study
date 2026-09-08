/**
 * ローディング中の骨格。タブを切り替えた瞬間に出す(Next.js の loading.tsx から使う)。
 *
 * 何も出ないまま待たせると、押した操作が効いたのか分からず本人が焦る。
 * 形だけでもすぐ出すことで「切り替わった」ことを即座に伝える。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-2xl ${className ?? ''}`}
      style={{ background: 'var(--plane)' }}
    />
  );
}
