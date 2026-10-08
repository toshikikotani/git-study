import Link from 'next/link';
import { MdNotificationsNone } from 'react-icons/md';

import { MoreMenu } from '@/components/ui/more-menu';
import { countUnread } from '@/features/alerts/inbox';
import { getCurrentAccount } from '@/features/auth/owner';
import { todayJst } from '@/lib/date';
import { homeDateLine } from './date-line';

/**
 * ホームの見出し(デザインの「今日」、ADR-085):日付と残りの日数、大きな「今日」、右上に
 * 「その他」(給料日・設定・ログアウトなど)とお知らせ(まだ見ていないものがあれば印)。
 */
export async function HomeHeader() {
  const today = todayJst();
  const [unread, account] = await Promise.all([countUnread().catch(() => 0), getCurrentAccount()]);
  return (
    <header className="flex items-end justify-between gap-2 px-1 pb-1">
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {homeDateLine(today)}
        </p>
        <h1
          className="text-xl leading-tight font-bold tracking-[-0.02em]"
          style={{ color: 'var(--ink)' }}
        >
          今日
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <MoreMenu account={account} />
        <Link
          href="/notifications"
          aria-label={unread > 0 ? `お知らせ(まだ見ていないもの${unread}件)` : 'お知らせ'}
          className="glass relative flex size-11 min-h-11 items-center justify-center rounded-full"
          style={{
            background: 'var(--surface)',
            color: 'var(--ink)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <MdNotificationsNone aria-hidden size={22} />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute top-2 right-2 size-2.5 rounded-full"
              style={{ background: 'var(--state-over)', boxShadow: '0 0 0 2px var(--surface)' }}
            />
          ) : null}
        </Link>
      </div>
    </header>
  );
}
