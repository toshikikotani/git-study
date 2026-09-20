'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MdCameraAlt } from 'react-icons/md';

import { Fab } from '@/components/ui/fab';
import { MoreMenu } from '@/components/ui/more-menu';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { setPendingReceiptFiles } from '@/features/import/pending-receipt-files';

/**
 * 本人発案:「家計簿(ちりつも)に飛ぶ動線が難しい」「レシートの取り込み口が
 * わかりづらい」への対応。/transactions の見出しに小さい文字リンクを並べる
 * だけでは、ホーム・明細・給料日と並ぶタブほどの発見性が無かった。
 * 家計簿(/spending)をタブに追加し、レシート撮影は毎回の記録行動そのもの
 * (設計原則2:記録の手間を最小化)なので、どの画面からでも1タップで開ける
 * 専用ボタンとして常設する(タブの隣に置くと埋もれるため別枠にした)。
 *
 * ── 主タブは4つまで(本人発案) ─────────────────────────────
 * 別アプリ(pairs)のスクリーンショットを見せて「メニューが少し大きくて
 * タップしにくい、pairsみたいにメニュー4つまで」と要望。以前はホーム/
 * 家計簿/明細/負債/給料日の5タブ+その他で計6項目が1本のピルに詰まって
 * いたため、確認の上、ホーム・家計簿・明細・給料日の4つに絞った(負債は
 * その他メニューへ)。「その他」自体もタブの6つ目から、ピルの隣に独立した
 * 丸ボタンへ切り出した(src/components/ui/more-menu.tsx)——タブ数を
 * 増やさずに済み、それぞれの押しやすい大きさを保てる。負債・口座・ルール・
 * 投資・副業・転職準備・レポート・朝配信・AI相談・設定群など、タブから
 * 辿り着けない画面はすべてこの丸ボタンから開くドロップアップメニュー
 * (MoreMenu)に集約する。
 *
 * ボトムナビは Apple の Liquid Glass 風(ADR-028、ADR-027の Material
 * Navigation Bar から置き換え)——本人が実際に触っている別アプリの
 * スクリーンショット(半透明にぼかした帯+選択時に水のように弾むピル)を
 * 見せて要望されたため、それに直接寄せた。バーの背景は半透明+ぼかし
 * (backdrop-filter)にし、アクティブ項目の背後のピルは色の変化と
 * わずかな拡大を「行き過ぎてから収まる」スプリングのイージングで
 * 動かして弾む感触を作る(ripple のような Material の水紋ではなく、
 * Apple のタップ時に「軽く縮んでバネで戻る」感触に合わせた)。
 * レシート撮影ボタンは正式な Fab コンポーネントに置き換えた。
 *
 * `<main>` を PullToRefresh(ADR-029)で包み、全画面に「引っ張って更新」を
 * 効かせる。一回読み込んだ画面はそのまま表示を保持し(next.config.ts の
 * staleTimes)、明示的に下へ引っ張ったときだけ最新化する。
 */
const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/spending', label: '家計簿' },
  { href: '/transactions', label: '明細' },
  { href: '/payday', label: '給料日' },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <PullToRefresh>
        <main className="flex-1 px-4 pt-6 pb-40">{children}</main>
      </PullToRefresh>

      {/* 片手で届く位置に浮かせる。主な閲覧はスマートフォン(NFR-07) */}
      <div className="fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* 記録の主な入り口だとひと目でわかるよう、タブとは別に中央に置く
            (本人発案)。アイコンだけにして、余計な文字を足さない。
            絵文字は本人の指摘で撤廃し、react-icons(Material Icons)に
            差し替えた。FAB 自体は塗り潰しの円のまま(ADR-028、ガラス素材は
            ナビゲーション chrome にだけ使う方針)。
            押した瞬間にカメラアプリが開くよう(本人発案)、href での画面遷移
            ではなく onFiles(カメラ起動の input)にした。撮影後は
            pending-receipt-files.ts 経由でファイルを /transactions/receipt
            へ渡し、そちらの画面が続きの抽出・分類・保存を行う。 */}
        <Fab
          label="レシートを撮る"
          onFiles={(files) => {
            setPendingReceiptFiles(files);
            router.push('/transactions/receipt');
          }}
        >
          <MdCameraAlt aria-hidden size={26} />
        </Fab>

        {/* 主タブ(最大4つ)のピルと、独立した「その他」丸ボタンを横並びにする。
            以前はその他もピルの6項目目だったため1項目が詰まって小さかった
            (本人発案での見直し、上のコメント参照)。 */}
        <div className="flex w-full max-w-md items-center gap-2">
          <nav className="min-w-0 flex-1">
            <ul
              className="flex items-end gap-1 p-2"
              style={{
                borderRadius: 'var(--radius-xl)',
                background: 'var(--glass-tint)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                border: '1px solid var(--glass-border)',
                boxShadow: 'var(--glass-shadow)',
              }}
            >
              {NAV.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href} className="flex-1">
                    <Link
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className="flex flex-col items-center gap-1 py-2"
                    >
                      {/* アクティブ項目は背後にピルを敷く。scale を 0.9→1 で
                          遷移させ、スプリングのイージングで一瞬 1 を超えてから
                          収まることで「弾む」感触を作る(ADR-028)。 */}
                      <span
                        className="label-text px-2 py-0.5 text-[11px] whitespace-nowrap"
                        style={{
                          borderRadius: 'var(--radius-full)',
                          transform: isActive ? 'scale(1)' : 'scale(0.9)',
                          transition: `background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-medium) var(--ease-spring)`,
                          background: isActive ? 'var(--accent-track)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
                        }}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <MoreMenu />
        </div>
      </div>
    </div>
  );
}
