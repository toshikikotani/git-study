'use client';

/**
 * ボトムナビの「もっと」— 全画面を網羅するドロップアップメニュー(新機能)。
 *
 * ── なぜ要るか ──────────────────────────────────────────────
 * ボトムナビは4件(ホーム/負債/明細/給料日)に絞っている。それ以外の画面
 * (口座・ルール・投資・副業・転職準備・レポート・朝配信・設定群・レシート
 * 撮影・メール貼り付け・突き合わせ)は、各画面に散らばった導線からしか
 * 辿れず、どこに何があるか把握しづらい。この一覧をここへ集約する。
 *
 * ── なぜアンマウントしないのか ──────────────────────────────
 * 開閉のたびに DOM を作り直すと、閉じるときのアニメーションを再生する前に
 * 消えてしまう。常時マウントしたまま transform/opacity と pointer-events を
 * 切り替えることで、開閉どちらの向きも同じ transition で処理する。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// `as const` にして href をリテラル型のまま保つ。Next の typed routes(next.config.ts)は
// `<Link href>` に渡る型がリテラルの Route であることを要求するため、途中で
// `string` に広げると型検査で弾かれる。
const GROUPS = [
  {
    title: '記録を増やす',
    items: [
      { href: '/transactions/receipt', label: 'レシートを撮る', dek: '現金・電子マネーの支払い' },
      {
        href: '/transactions/paste',
        label: 'メールを貼り付ける',
        dek: '通知メールの一時的な取り込み',
      },
      { href: '/accounts', label: '口座' },
      { href: '/transactions/reconcile', label: '請求突合' },
    ],
  },
  {
    title: '分類を育てる',
    items: [
      { href: '/rules', label: 'カテゴリと分類ルール' },
      { href: '/rules/chat', label: 'ルールをAIに相談する', dek: '会話でルールを変更' },
    ],
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
      { href: '/settings/password', label: 'パスワード' },
      { href: '/settings/rescued-emails', label: '読み取れなかったメール' },
    ],
  },
] as const;

export function MoreMenu() {
  const [open, setOpen] = useState(false);
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
      <li className="flex-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="block w-full rounded-full py-2.5 text-center text-[13px] font-medium transition-colors"
          style={
            open
              ? { background: 'var(--accent)', color: '#ffffff' }
              : { color: 'var(--ink-secondary)' }
          }
        >
          もっと
        </button>
      </li>

      {/* 背景。フェードのみ、動きは付けない(方向感が要らない) */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 transition-opacity duration-200 ease-out motion-reduce:transition-none"
        style={{
          background: 'rgba(10, 16, 32, 0.45)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* シート本体。iOS の sheet と同じ曲線(0.32,0.72,0,1)で「行き過ぎてから収まる」動きにする */}
      <div
        role="menu"
        aria-hidden={!open}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-[360ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(110%)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div
          className="max-h-[75dvh] overflow-y-auto rounded-[28px] p-2"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: '0 -4px 32px -4px rgba(10,16,32,0.35)',
          }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1.5 w-10 rounded-full" style={{ background: 'var(--hairline)' }} />
          </div>

          <div className="flex items-center justify-between px-3 pt-1 pb-2">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              メニュー
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12px]"
              style={{ color: 'var(--ink-muted)' }}
            >
              閉じる
            </button>
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
                <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--plane)' }}>
                  {group.items.map((item, i) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
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
