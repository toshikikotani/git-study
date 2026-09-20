'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MdCameraAlt } from 'react-icons/md';

import { Fab } from '@/components/ui/fab';
import { MoreMenu } from '@/components/ui/more-menu';

/**
 * 本人発案:「家計簿(ちりつも)に飛ぶ動線が難しい」「レシートの取り込み口が
 * わかりづらい」への対応。/transactions の見出しに小さい文字リンクを並べる
 * だけでは、ホーム・負債・明細・給料日と並ぶタブほどの発見性が無かった。
 * 家計簿(/spending)をタブに追加し、レシート撮影は毎回の記録行動そのもの
 * (設計原則2:記録の手間を最小化)なので、どの画面からでも1タップで開ける
 * 専用ボタンとして常設する(タブの隣に置くと埋もれるため別枠にした)。
 *
 * それでも辿り着けない画面(口座・ルール・投資・副業・転職準備・レポート・
 * 朝配信・AI相談・設定群など)は、タブの末尾「その他」から開くドロップアップ
 * メニュー(MoreMenu)に集約する。
 *
 * ボトムナビは Material 3 の Navigation Bar 仕様(ADR-027)——アクティブ
 * 項目の背後に pill 型のインジケータを敷き、ラベルは常時表示する。
 * レシート撮影ボタンは正式な Fab コンポーネントに置き換えた。
 */
const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/spending', label: '家計簿' },
  { href: '/transactions', label: '明細' },
  { href: '/debts', label: '負債' },
  { href: '/payday', label: '給料日' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pt-6 pb-40">{children}</main>

      {/* 片手で届く位置に浮かせる。主な閲覧はスマートフォン(NFR-07) */}
      <div className="fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* 記録の主な入り口だとひと目でわかるよう、タブとは別に中央に置く
            (本人発案)。アイコンだけにして、余計な文字を足さない。
            絵文字は本人の指摘で撤廃し、react-icons(Material Icons)に
            差し替えた(ADR-027 の続き)。 */}
        <Fab href="/transactions/receipt" label="レシートを撮る">
          <MdCameraAlt aria-hidden size={26} />
        </Fab>

        <nav className="w-full max-w-md">
          <ul
            className="flex items-end gap-1 p-2 backdrop-blur-xl"
            style={{
              borderRadius: 'var(--md-shape-xl)',
              background: 'color-mix(in srgb, var(--md-surface-container-high) 90%, transparent)',
              boxShadow: 'var(--md-elevation-2)',
            }}
          >
            {NAV.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className="flex flex-col items-center gap-1 py-2 transition-colors"
                    style={{
                      transitionDuration: 'var(--md-duration-short)',
                      transitionTimingFunction: 'var(--md-easing-standard)',
                    }}
                  >
                    {/* Material 3 の Navigation Bar:アクティブ項目は
                        pill 型インジケータ(secondary-container)を背後に敷く。
                        ラベルは常に表示し、色だけで状態を運ばない。 */}
                    <span
                      className="md-label-large px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors"
                      style={{
                        borderRadius: 'var(--md-shape-full)',
                        transitionDuration: 'var(--md-duration-short)',
                        background: isActive ? 'var(--md-primary-container)' : 'transparent',
                        color: isActive
                          ? 'var(--md-on-primary-container)'
                          : 'var(--md-on-surface-variant)',
                      }}
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
            <MoreMenu />
          </ul>
        </nav>
      </div>
    </div>
  );
}
