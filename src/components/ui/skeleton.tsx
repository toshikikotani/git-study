/**
 * ローディング中の骨格。タブを切り替えた瞬間に出す(Next.js の loading.tsx から使う)。
 *
 * 何も出ないまま待たせると、押した操作が効いたのか分からず本人が焦る。
 * 形だけでもすぐ出すことで「切り替わった」ことを即座に伝える。
 *
 * ── なぜ `--plane` をそのまま使わないのか(本人からの不具合報告) ──────
 * 「タイトルのみ先に表示され、そのコンテンツは表示されないけどloadingも
 * されていない」——原因は色の一致だった。loading.tsx はページの
 * `<main>`(= `body` と同じ `--plane` 背景)の上に直接置かれるが、この
 * コンポーネントの背景も `--plane` だったため、骨格の矩形が背景と完全に
 * 同化して見えなくなっていた(`animate-pulse` の不透明度アニメーションも、
 * 同色同士では見た目上まったく変化しない)。`--ink` を薄く重ねた透過の
 * ティントにすることで、`--plane`(ページ本体)の上でも `--surface` 系
 * (カード内)の上でも、テーマ(light/dark)を問わず常に周囲と区別できる
 * ようにした。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-2xl ${className ?? ''}`}
      style={{ background: 'color-mix(in srgb, var(--ink) 10%, transparent)' }}
    />
  );
}
