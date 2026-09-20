import type { Metadata, Viewport } from 'next';
import { Roboto_Flex, M_PLUS_2 } from 'next/font/google';

import './globals.css';

/**
 * 書体(セルフホスト)
 *
 * next/font はビルド時にフォントを取得してビルド成果物へ同梱する。
 * 実行時に Google へリクエストが飛ばないため、外部への通信が増えず、
 * 端末に何が入っていても同じ見た目になる。
 *
 * ── なぜ端末任せをやめたか ──────────────────────────────────
 * system-ui 指定は iPhone なら SF Pro、Windows なら Segoe UI と、
 * 環境ごとに別の書体になる。日本語に至っては端末によって 20 年前の
 * 書体に落ちることもある。毎日開かせたい画面で、見え方が保証できない
 * のは受け入れられない。
 *
 * ── 選定(ADR-027で英数字のみ変更) ────────────────────────
 * Roboto Flex  数字と英字。Material Design の標準書体ファミリー
 *              (ADR-027の本格導入方針)。可変フォントだが等幅数字
 *              (tabular figures)の品質は ADR-017 が Inter を選んだ
 *              理由をそのまま満たす。表や軸で使う(.tabular)
 * M PLUS 2     日本語。ADR-017の判断を維持(Noto Sans JP より軽量・
 *              UI向き、情報密度の高い画面と相性がよい)
 *
 * 日本語は容量が大きいため preload しない。数字が先に出て日本語が
 * 後から差し替わるが、最上部のヒーローは数字なので実害が小さい。
 */
const roboto = Roboto_Flex({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
});

const mplus2 = M_PLUS_2({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-jp',
});

export const metadata: Metadata = {
  title: '資産形成',
  description: '負債の完済と資産形成を構造で支える、本人専用の個人財務環境',
  // 本人専用。検索結果にも SNS のプレビューにも出さない(NFR-04)
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 主な閲覧はスマートフォン(NFR-07)
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${roboto.variable} ${mplus2.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
