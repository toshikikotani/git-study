import { formatYen } from '@/domain/money';
import type { DetectedSubscription } from '@/domain/subscriptions';
import { formatDateJa } from '@/lib/date';

/**
 * 検知した定期支払い(サブスク、本人発案)。
 *
 * 新しいテーブルは持たず domain/subscriptions.ts が都度計算した結果を
 * そのまま表示するだけ(features/subscriptions/store.ts 参照)。
 */
export function SubscriptionsCard({ subscriptions }: { subscriptions: DetectedSubscription[] }) {
  if (subscriptions.length === 0) return null;

  const totalYen = subscriptions.reduce((a, s) => a + s.amountYen, 0);

  return (
    <section
      aria-label="定期支払い"
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
          定期支払い({subscriptions.length} 件)
        </p>
        <p className="tabular text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          月あたり {formatYen(totalYen)}
        </p>
      </div>

      <dl className="mt-3 space-y-2">
        {subscriptions.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between gap-3 text-xs">
            <dt style={{ color: 'var(--ink-secondary)' }}>
              {s.label}
              <span className="ml-2" style={{ color: 'var(--ink-muted)' }}>
                前回 {formatDateJa(s.lastOccurredOn)}・{s.occurrenceCount}回目
              </span>
            </dt>
            <dd className="tabular" style={{ color: 'var(--ink-secondary)' }}>
              {formatYen(s.amountYen)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
