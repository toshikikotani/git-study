import Link from 'next/link';
import { MdNotificationsNone } from 'react-icons/md';

import { countUnread } from '@/features/alerts/inbox';
import { daysBetween, splitDateOnly, todayJst, weekdayOf } from '@/lib/date';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 「10月6日(火) · 10月は残り26日」 */
export function homeDateLine(today: string): string {
  const [year, month, day] = splitDateOnly(today);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
  const left = daysBetween(today, monthEnd) + 1;
  return `${month}月${day}日(${WEEKDAYS[weekdayOf(today)]}) · ${month}月は残り${left}日`;
}

/**
 * ホームの見出し(デザインのホーム):日付と残りの日数、「今日の家計」、お知らせボタン
 * (まだ見ていないお知らせがあれば件数の印)。
 */
export async function HomeHeader() {
  const today = todayJst();
  const unread = await countUnread().catch(() => 0);
  return (
    <header className="flex items-end justify-between gap-2 px-1">
      <div>
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {homeDateLine(today)}
        </p>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>
          今日の家計
        </h1>
      </div>
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `お知らせ(まだ見ていないもの${unread}件)` : 'お知らせ'}
        className="relative flex size-11 min-h-11 items-center justify-center rounded-full"
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
            className="tabular absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold"
            style={{ background: 'var(--state-over)', color: 'var(--surface)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </Link>
    </header>
  );
}
