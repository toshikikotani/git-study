import { BackHeader } from '@/components/ui/back-header';
import { listInbox, type InboxItem } from '@/features/alerts/inbox';
import { MarkReadButton } from './mark-read-button';
import { RiskyRulesCard } from './risky-rules-card';

/**
 * お知らせ(デザインのホームのお知らせボタンの先、ADR-078)。これまで Discord などにだけ
 * 送っていた通知(alerts)を、アプリの中でも新しい順に見られるようにする。
 * 危険な支払い方法(リボ・キャッシング・分割)の検知のしかたもここで見る(もとはカテゴリ分析、ADR-127)。
 */
export const dynamic = 'force-dynamic';

const SEVERITY_LABEL: Record<InboxItem['severity'], string> = {
  info: 'お知らせ',
  warn: '注意',
  critical: '大事',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 3_600_000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

export default async function NotificationsPage() {
  const items = await listInbox().catch(() => []);
  const unread = items.filter((item) => !item.read).length;
  return (
    <div className="rise space-y-4">
      <BackHeader
        back={{ href: '/', label: '今日' }}
        title="お知らせ"
        action={unread > 0 ? <MarkReadButton /> : undefined}
      />
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
          この60日のお知らせはありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="glass space-y-1 rounded-2xl p-4"
              style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <p
                className="flex items-center gap-2 text-xs"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {item.read ? null : (
                  <span
                    className="size-2 rounded-full"
                    style={{ background: 'var(--action)' }}
                    aria-label="未読"
                  />
                )}
                <span className="font-semibold">{SEVERITY_LABEL[item.severity]}</span>
                <span className="tabular">{formatWhen(item.triggeredAt)}</span>
              </p>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                {item.title}
              </p>
              {item.body ? (
                <p
                  className="text-sm leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {item.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <RiskyRulesCard />
    </div>
  );
}
