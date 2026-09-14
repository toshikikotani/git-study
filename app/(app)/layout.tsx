'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
            (本人発案)。アイコンだけにして、余計な文字を足さない。 */}
        <Link
          href="/transactions/receipt"
          aria-label="レシートを撮る"
          className="flex size-14 shrink-0 items-center justify-center rounded-full ring-1 backdrop-blur-xl"
          style={{
            background: 'var(--accent)',
            color: '#ffffff',
            boxShadow: '0 4px 24px -8px rgba(0,0,0,0.35)',
          }}
        >
          <span aria-hidden className="text-2xl leading-none">
            📷
          </span>
        </Link>

        <nav className="w-full max-w-md">
          <ul
            className="flex rounded-full p-1 ring-1 backdrop-blur-xl"
            style={{
              background: 'color-mix(in srgb, var(--surface-raised) 82%, transparent)',
              boxShadow: '0 4px 24px -8px rgba(0,0,0,0.25)',
            }}
          >
            {NAV.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className="block rounded-full py-2.5 text-center text-[13px] font-medium transition-colors"
                    style={
                      isActive
                        ? { background: 'var(--accent)', color: '#ffffff' }
                        : { color: 'var(--ink-secondary)' }
                    }
                  >
                    {item.label}
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
