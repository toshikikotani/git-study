'use client';

/**
 * ボトムナビの「その他」— 全画面を網羅するドロップアップメニュー。
 *
 * ── なぜ要るか ──────────────────────────────────────────────
 * ボトムナビ(ホーム/家計簿/明細/給料日)と、レシート撮影の専用ボタンで
 * 主要な動線はカバーできても、それ以外の画面(負債・口座・ルール・AI相談・
 * 投資・副業・転職準備・レポート・朝配信・設定群・メール貼り付け・請求突合・
 * 重複確認)は各画面に散らばった導線からしか辿れず、どこに何があるか
 * 把握しづらい。この一覧をここへ集約する。よく使う画面はここに加えて
 * 元の画面からも辿れるようにしてある(例:ルール一覧 → /transactions の
 * ヘッダ、この画面自体も /rules のヘッダから)。
 *
 * ── なぜタブから独立した丸ボタンにしたのか(本人発案) ────────────
 * 以前はボトムナビの6つ目のタブだった。本人から「メニューが少し大きくて
 * タップしにくい、pairsみたいにメニュー4つまで」と要望があり、主タブを
 * ホーム・家計簿・明細・給料日の4つに絞った(負債は下記GROUPSへ移動)。
 * その他メニュー自体は6タブ目としてピルに詰め込むのをやめ、ナビの
 * ピル本体の隣に独立した丸いガラス素材ボタンとして置く
 * (app/(app)/layout.tsx)——タブ数を増やさずに済み、押しやすい大きさも
 * 確保できる。
 *
 * ── なぜ Portal で描画するのか(本人からの不具合報告への対応) ──
 * 以前はこのコンポーネントをボトムナビの `<ul>`(`backdrop-blur-xl` を持つ)の
 * 内側にそのまま描画していた。`backdrop-filter` は一部のブラウザで
 * 子孫の `position: fixed` の基準(containing block)になってしまい、
 * 背景タップで閉じるはずのオーバーレイがそのナビバーの小さな矩形内にしか
 * 存在しないことになっていた——「開くと画面のどこを押しても閉じない」という
 * 報告はこれが原因。`createPortal` で `document.body` 直下に描画し、
 * どんな祖先の CSS にも影響されない土台にした。
 *
 * ── なぜアンマウントしないのか ──────────────────────────────
 * 開閉のたびに DOM を作り直すと、閉じるときのアニメーションを再生する前に
 * 消えてしまう。常時マウントしたまま transform/opacity と pointer-events を
 * 切り替えることで、開閉どちらの向きも同じ transition で処理する。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdMoreHoriz } from 'react-icons/md';

/**
 * サーバー(document が無い)では false、クライアントでは true を返す。
 * `useEffect` + `setState` で切り替える一般的な書き方は、実質的に
 * 「マウント後に強制で1回再レンダーする」ための setState であり
 * react-hooks/set-state-in-effect(M2-3b で避けている理由と同じ:カスケード
 * するレンダーを増やす)に引っかかる。`useSyncExternalStore` はサーバー用と
 * クライアント用のスナップショットを別々に受け取れるため、同じ結果を
 * effect を経由せず得られる。
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// `as const` にして href をリテラル型のまま保つ。Next の typed routes(next.config.ts)は
// `<Link href>` に渡る型がリテラルの Route であることを要求するため、途中で
// `string` に広げると型検査で弾かれる。
const GROUPS = [
  {
    title: '記録する',
    items: [
      { href: '/debts', label: '負債' },
      {
        href: '/transactions/paste',
        label: 'メールを貼り付ける',
        dek: '通知メールの一時的な取り込み',
      },
      { href: '/accounts', label: '口座' },
      { href: '/transactions/reconcile', label: '請求突合' },
      { href: '/transactions/duplicates', label: '重複の確認' },
    ],
  },
  {
    title: '相談する',
    items: [
      { href: '/advisor', label: 'AI相談', dek: '目標設定・買う前相談' },
      { href: '/rules/chat', label: 'ルール相談', dek: '会話でルールを変更' },
    ],
  },
  {
    title: '分類を育てる',
    items: [{ href: '/rules', label: 'カテゴリ・ルール' }],
  },
  {
    title: 'この先に向けて',
    items: [
      { href: '/investments', label: '投資' },
      { href: '/side-hustle', label: '副業' },
      { href: '/job-change', label: '転職準備' },
    ],
  },
  {
    title: '振り返る',
    items: [
      { href: '/reports', label: 'レポート' },
      { href: '/briefs', label: '朝配信' },
    ],
  },
  {
    title: '設定',
    items: [
      { href: '/settings/gmail', label: 'Gmail連携' },
      { href: '/settings/google', label: 'Google連携' },
      { href: '/settings/password', label: 'パスワード' },
      { href: '/settings/rescued-emails', label: '読み取れなかったメール' },
    ],
  },
] as const;

export function MoreMenu() {
  const [open, setOpen] = useState(false);
  // createPortal は document.body を要求するため、サーバーレンダー(document が無い)
  // では描画しない。
  const isClient = useIsClient();
  const pathname = usePathname();

  // 画面遷移が起きたら(リンクを踏んだ・戻るボタンなど)必ず閉じる。
  // useEffect ではなくレンダー中の比較で行う(react-hooks/set-state-in-effect、
  // M2-3b と同じ理由でカスケードするレンダーを避ける)。
  const [pathAtOpen, setPathAtOpen] = useState(pathname);
  if (pathname !== pathAtOpen) {
    setPathAtOpen(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      {/* ナビのピル本体(app/(app)/layout.tsx)とは別の、独立したガラス素材の
          丸ボタン。タブの数を増やさずに押しやすい大きさを確保する
          (本人発案「pairsみたいにメニュー4つまで」)。 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="その他の機能"
        className="flex size-11 shrink-0 items-center justify-center"
        style={{
          borderRadius: 'var(--radius-full)',
          background: open ? 'var(--accent-track)' : 'var(--glass-tint)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-shadow)',
          color: open ? 'var(--accent)' : 'var(--ink-muted)',
          transform: open ? 'scale(1.05)' : 'scale(1)',
          transition: `background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-medium) var(--ease-spring)`,
        }}
      >
        <MdMoreHoriz aria-hidden size={22} />
      </button>

      {isClient
        ? createPortal(
            <MoreMenuOverlay open={open} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
    </>
  );
}

function MoreMenuOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* 背景。フェードのみ、動きは付けない(方向感が要らない)。ここをタップすると閉じる */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity duration-200 ease-out motion-reduce:transition-none"
        style={{
          background: 'rgba(10, 16, 32, 0.45)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* シート本体。UIKit のモーダル遷移に準じたイージング(ADR-028、
          ADR-027の emphasized-decelerate から置き換え)で「行き過ぎてから
          収まる」動きにする。 */}
      <div
        role="menu"
        aria-hidden={!open}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform will-change-transform motion-reduce:transition-none"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(110%)',
          transitionDuration: 'var(--duration-slow)',
          transitionTimingFunction: 'var(--ease-sheet)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Liquid Glass シート(ADR-028)。ボトムナビと同じ半透明+ぼかしの
            素材だが、内容を覆い隠す面なので strong(より濃いティント)を使う。 */}
        <div
          className="max-h-[75dvh] overflow-y-auto p-2"
          style={{
            borderRadius: 'var(--radius-xl)',
            background: 'var(--glass-tint-strong)',
            backdropFilter: 'var(--glass-blur-strong)',
            WebkitBackdropFilter: 'var(--glass-blur-strong)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow-float)',
          }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1.5 w-10 rounded-full" style={{ background: 'var(--hairline)' }} />
          </div>

          <div className="flex items-center justify-between px-3 pt-1 pb-2">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              その他の機能
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              外側をタップで閉じる
            </span>
          </div>

          <div className="flex flex-col gap-4 px-1 pt-1 pb-3">
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h3
                  className="px-2 pb-1.5 text-[11px] font-medium tracking-[0.06em] uppercase"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {group.title}
                </h3>
                <div
                  className="overflow-hidden"
                  style={{ borderRadius: 'var(--radius-md)', background: 'var(--surface)' }}
                >
                  {/* prefetch={false}:app/(app)/layout.tsx のナビと同じ理由
                      (本人からの不具合報告「読み込み中に画面全体にローディング
                      表示されない」)。 */}
                  {group.items.map((item, i) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      role="menuitem"
                      onClick={onClose}
                      className="flex items-center justify-between gap-3 px-4 py-3 active:opacity-60"
                      style={{
                        borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                      }}
                    >
                      <span>
                        <span
                          className="block text-[14px] font-medium"
                          style={{ color: 'var(--ink)' }}
                        >
                          {item.label}
                        </span>
                        {'dek' in item ? (
                          <span
                            className="mt-0.5 block text-[11.5px]"
                            style={{ color: 'var(--ink-muted)' }}
                          >
                            {item.dek}
                          </span>
                        ) : null}
                      </span>
                      <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                        →
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
