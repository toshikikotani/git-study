import Link from 'next/link';

import { SettingsLink } from '@/components/ui/settings-link';
import { countUnread } from '@/features/alerts/inbox';
import { todayJst } from '@/lib/date';
import { homeDateLine } from './date-line';

/**
 * ホームの見出し(デザイン仕様書の「今日」、ADR-090):大きな「今日」と、その横に日付と曜日
 * (本人の要望「今日の横に日付が欲しい」)。右上にお知らせ(まだ見ていないものがあれば印)と
 * 設定の歯車(どのタブにも同じ場所に置く、ADR-127)。
 */
export async function HomeHeader() {
  const today = todayJst();
  const unread = await countUnread().catch(() => 0);
  return (
    <header className="flex items-center justify-between gap-2 px-1 pt-2 pb-1">
      <h1
        className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[34px] leading-tight font-bold"
        style={{ color: 'var(--ink)' }}
      >
        今日
        <span className="text-[17px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
          {homeDateLine(today)}
        </span>
      </h1>
      <div className="flex items-center gap-2">
        <Link
          href="/notifications"
          aria-label={unread > 0 ? `お知らせ(${unread}件)` : 'お知らせ'}
          className="relative flex size-11 min-h-11 items-center justify-center rounded-full"
          style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <svg
            aria-hidden
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute top-2 right-3 size-3 rounded-full"
              style={{ background: 'var(--notify)', border: '2px solid var(--surface)' }}
            />
          ) : null}
        </Link>
        <SettingsLink />
      </div>
    </header>
  );
}
