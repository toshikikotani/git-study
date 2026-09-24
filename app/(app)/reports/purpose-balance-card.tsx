import { formatYen } from '@/domain/money';
import type { PurposeBalance } from '@/domain/account';
import { ACCOUNT_PURPOSE_LABELS } from '../accounts/kind-labels';

/**
 * 口座の用途別残高(MoneyForward MEとの機能比較調査、issue #98)。
 *
 * ── 色について ────────────────────────────────────────────────
 * 用途ごとの残高はプラス(資産)・マイナス(クレジットカードの未払い残高)の
 * 両方がありうる——単一のカテゴリカル色では符号が読み取れないため、
 * income-expense-chart.tsx と同じ考え方で、行ごとに符号で色を分ける
 * (プラス=var(--income)、マイナス=var(--over))。
 */
export function PurposeBalanceCard({ balances }: { balances: readonly PurposeBalance[] }) {
  if (balances.length === 0) {
    return (
      <div
        className="rounded-[22px] p-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          用途別の残高
        </h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          口座の登録がありません。/accounts から登録すると、ここに用途別の残高が出ます。
        </p>
      </div>
    );
  }

  const maxAbsYen = Math.max(...balances.map((b) => Math.abs(b.totalYen)), 1);

  return (
    <div
      className="rounded-[22px] p-5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        用途別の残高
      </h2>

      <ol className="mt-4 space-y-3">
        {balances.map((balance) => {
          const isNegative = balance.totalYen < 0;
          const color = isNegative ? 'var(--over)' : 'var(--income)';
          const track = isNegative ? 'var(--over-track)' : 'var(--income-track)';
          const percent = Math.round((Math.abs(balance.totalYen) / maxAbsYen) * 100);
          const label =
            ACCOUNT_PURPOSE_LABELS[balance.purpose as keyof typeof ACCOUNT_PURPOSE_LABELS] ??
            balance.purpose;

          return (
            <li key={balance.purpose}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {label}
                  </span>
                  <span className="tabular shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {balance.accountCount}口座
                  </span>
                </span>
                <span className="tabular shrink-0 font-medium" style={{ color }}>
                  {formatYen(balance.totalYen)}
                </span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full"
                style={{ background: track }}
                title={`${label}: ${formatYen(balance.totalYen)}(${balance.accountCount}口座)`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percent}%`, background: color }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
