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
 * 元の画面からも辿れるようにしてある(例:ジャンル一覧 → /assistant の
 * ヘッダから)。
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
 * どんな祖先の CSS にも影響されない土台にした。シートの枠自体は
 * `bottom-sheet.tsx`(明細行の長押しプレビューと共有)が担う。
 *
 * ── なぜアンマウントしないのか ──────────────────────────────
 * 開閉のたびに DOM を作り直すと、閉じるときのアニメーションを再生する前に
 * 消えてしまう。常時マウントしたまま transform/opacity と pointer-events を
 * 切り替えることで、開閉どちらの向きも同じ transition で処理する
 * (`bottom-sheet.tsx` も同じ理由でアンマウントしない)。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MdMoreHoriz } from 'react-icons/md';

import { BottomSheet } from './bottom-sheet';
import { useIsOwner } from './owner-context';

// `as const` にして href をリテラル型のまま保つ。Next の typed routes(next.config.ts)は
// `<Link href>` に渡る型がリテラルの Route であることを要求するため、途中で
// `string` に広げると型検査で弾かれる。
const GROUPS = [
  {
    title: '記録する',
    items: [
      { href: '/debts', label: '負債', ownerOnly: true },
      {
        href: '/transactions/new',
        label: '明細を手で登録する',
        dek: '現金払いなど、取り込みに乗らない明細を1件だけ記録',
      },
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
      {
        href: '/assistant',
        label: 'AIに相談',
        dek: '意見を話すと、設定・予算・目標をまとめて変更案に',
      },
      { href: '/advisor', label: '目標', dek: '進行中の目標と進捗' },
    ],
  },
  {
    title: 'この先に向けて',
    items: [
      { href: '/investments', label: '投資', ownerOnly: true },
      { href: '/side-hustle', label: '副業', ownerOnly: true },
      { href: '/job-change', label: '転職準備', ownerOnly: true },
    ],
  },
  {
    title: '振り返る',
    items: [
      { href: '/reports', label: 'レポート' },
      { href: '/reports/ai', label: 'AIレポート', dek: '日次・月次の気づき・アドバイス' },
      {
        href: '/reports/genres',
        label: 'ジャンル管理・分析',
        dek: 'ジャンルの追加削除・予算設定、AIによる客観的な支出分類',
      },
      { href: '/briefs', label: '朝配信', ownerOnly: true },
    ],
  },
  {
    title: '設定',
    items: [
      { href: '/settings/ai', label: 'AI機能', dek: 'AIをまとめてオン/オフ' },
      { href: '/settings/gmail', label: 'Gmail連携', ownerOnly: true },
      { href: '/settings/google', label: 'Google連携', ownerOnly: true },
      { href: '/settings/password', label: 'パスワード' },
      { href: '/settings/rescued-emails', label: '読み取れなかったメール', ownerOnly: true },
    ],
  },
] as const;

/** オーナー以外には、オーナー専用の項目(連携系)を出さない。項目が空になった見出しも出さない。 */
export function visibleGroups(isOwner: boolean) {
  return GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isOwner || !('ownerOnly' in i && i.ownerOnly)),
  })).filter((g) => g.items.length > 0);
}

export function MoreMenu() {
  const [open, setOpen] = useState(false);
  // 連携系(Gmail・Google・朝配信など、オーナーの資格情報で動くもの)は、オーナー以外には出さない。
  const isOwner = useIsOwner();
  const groups = visibleGroups(isOwner);
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
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
        style={{
          borderRadius: 'var(--radius-full)',
          background: open ? 'var(--accent-track)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--ink-secondary)',
          transition: `background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)`,
        }}
      >
        <MdMoreHoriz aria-hidden size={22} />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} role="menu">
        <div className="flex items-center justify-between px-3 pt-1 pb-2">
          <h2 className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            その他の機能
          </h2>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            外側をタップで閉じる
          </span>
        </div>

        <div className="flex flex-col gap-4 px-1 pt-1 pb-3">
          {groups.map((group) => (
            <section key={group.title}>
              <h3
                className="px-2 pb-2 text-xs font-medium tracking-[0.06em] uppercase"
                style={{ color: 'var(--ink-muted)' }}
              >
                {group.title}
              </h3>
              <div
                className="overflow-hidden"
                style={{ borderRadius: 'var(--radius-inner)', background: 'var(--surface)' }}
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
                    onClick={() => setOpen(false)}
                    className="min-h-11 flex items-center justify-between gap-3 px-4 py-3 active:opacity-60"
                    style={{
                      borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                    }}
                  >
                    <span>
                      <span className="block text-sm font-medium" style={{ color: 'var(--ink)' }}>
                        {item.label}
                      </span>
                      {'dek' in item ? (
                        <span
                          className="mt-1 block text-[11.5px]"
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
      </BottomSheet>
    </>
  );
}
