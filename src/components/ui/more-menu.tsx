'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MdMoreHoriz } from 'react-icons/md';

import { signOutAction } from '@/features/auth/actions';
import { BottomSheet } from './bottom-sheet';

const GROUPS = [
  {
    title: '記録する',
    items: [
      { href: '/plan', label: '目標', dek: '期間ごとの、ジャンル別に使う額' },
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
    ],
  },
  {
    title: 'この先に向けて',
    items: [
      { href: '/savings', label: '貯金', dek: '貯金目標と貯まり具合' },
      { href: '/investments', label: '投資' },
      { href: '/side-hustle', label: '副業' },
      { href: '/job-change', label: '転職準備' },
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
      { href: '/briefs', label: '朝配信' },
    ],
  },
  {
    title: '設定',
    items: [
      { href: '/settings/theme', label: '色', dek: '背景・文字・強調を変える' },
      { href: '/settings/ai', label: 'AI機能', dek: 'AIをまとめてオン/オフ' },
      { href: '/settings/gmail', label: 'Gmail連携' },
      { href: '/settings/google', label: 'Google連携' },
      { href: '/settings/password', label: 'パスワード' },
      { href: '/settings/rescued-emails', label: '読み取れなかったメール' },
    ],
  },
] as const;

export function MoreMenu({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="その他の機能"
        className="flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center px-2 text-xs"
        style={{
          gap: 2,
          borderRadius: 'var(--radius-full)',
          background: open ? 'var(--accent-track)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--ink-secondary)',
          transition: `background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)`,
        }}
      >
        <MdMoreHoriz aria-hidden size={20} />
        <span aria-hidden>その他</span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} role="menu">
        <div className="flex items-center justify-between px-3 pt-1 pb-2">
          <h2 className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            その他の機能
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-1 pt-1 pb-3">
          {GROUPS.map((group) => (
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
                {group.items.map((item, i) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    role="menuitem"
                    onClick={(e) => {
                      const scroller = (e.currentTarget as HTMLElement).closest(
                        '[data-sheet-scroll]',
                      );
                      if (scroller instanceof HTMLElement && scroller.dataset.moved === '1') {
                        e.preventDefault();
                        return;
                      }
                      onNavigate?.(item.href);
                      setOpen(false);
                    }}
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

          <form
            action={signOutAction}
            onSubmit={() => {
              try {
                window.sessionStorage.clear();
              } catch {
                // 消せなくてもログアウトは続ける
              }
            }}
          >
            <button
              type="submit"
              className="min-h-11 w-full rounded-2xl px-4 py-3 text-left text-sm font-medium"
              style={{ background: 'var(--surface)', color: 'var(--over)' }}
            >
              ログアウト
            </button>
          </form>
        </div>
      </BottomSheet>
    </>
  );
}
