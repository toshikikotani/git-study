import Link from 'next/link';

/**
 * 見つからない画面(Next.js 既定の英語の「404 This page could not be found.」の代わり)。
 * どこへ戻ればよいかを、今日の画面へのボタンで示す(Impeccable の点検、ADR-136)。
 */
export default function NotFound() {
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-4"
      style={{ color: 'var(--ink)' }}
    >
      <h1 className="text-[34px] leading-tight font-bold">画面が見つかりません</h1>
      <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        リンクが古いか、この画面はもうありません。記録や設定はそのまま残っています。
      </p>
      <Link
        href="/"
        className="btn-primary inline-flex min-h-12 items-center rounded-full px-6 text-[17px] font-semibold"
      >
        今日へ戻る
      </Link>
    </main>
  );
}
