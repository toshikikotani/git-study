import Link from 'next/link';

import { subscriptionKeyOf } from '@/domain/subscriptions';
import { listReceiptItemsForTransactionIds } from '@/features/receipts/items-store';
import { loadLedgerTransactions } from '@/features/spending/entries';
import type { LedgerTransaction } from '@/features/spending/ledger-types';
import { listConfirmedFixedCostKeys } from '@/features/subscriptions/fixed-cost-store';
import { addDays, todayJst } from '@/lib/date';
import { CategoryMark } from '../category-sheet';

/** 出す件数(デザイン仕様書は3件)。 */
const COUNT = 3;
/** 予定はこの日数先まで(近いものから)。 */
const AHEAD_DAYS = 7;
/** 振り返る日数。 */
const BACK_DAYS = 60;

/** 2026-10-15 → 10/15 */
function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function isListed(t: LedgerTransaction): boolean {
  return !t.isTransfer && t.reviewStatus !== 'ignored' && !t.needsInput && t.amountYen !== 0;
}

/**
 * 最近の記録(デザイン仕様書の「今日」、ADR-090):新しい順に3件。この先の予定は「まだ使った額に
 * 入りません」、固定費は「固定費 · 10月分」と添える。「すべて」で明細へ。マークを押すとそのカテゴリ(⑦)。
 */
export async function RecentRecords() {
  const today = todayJst();
  const loaded = await loadLedgerTransactions(
    { from: addDays(today, -BACK_DAYS), to: addDays(today, AHEAD_DAYS) },
    today,
  ).catch(() => null);
  if (loaded === null) return null;
  const rows = loaded.transactions
    .filter(isListed)
    .sort((a, b) => (a.occurredOn === b.occurredOn ? 0 : a.occurredOn < b.occurredOn ? 1 : -1))
    .slice(0, COUNT);
  if (rows.length === 0) return null;
  const [items, fixedKeys] = await Promise.all([
    listReceiptItemsForTransactionIds(rows.map((r) => r.id)).catch(() => new Map()),
    listConfirmedFixedCostKeys().catch(() => new Set<string>()),
  ]);
  const isFixed = (t: LedgerTransaction) =>
    fixedKeys.has(subscriptionKeyOf(t.label, t.description, t.amountYen)) ||
    (t.genreId !== null && fixedKeys.has(`genre:${t.genreId}`));

  return (
    <section aria-labelledby="home-recent" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1 pt-3">
        <h2 id="home-recent" className="text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
          最近の記録
        </h2>
        <Link
          href="/spending"
          className="flex min-h-11 items-center text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          すべて
        </Link>
      </div>
      <ul className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)' }}>
        {rows.map((t, i) => {
          const scheduled = t.status === 'scheduled';
          const genre = t.genreName ?? '未分類';
          const firstItem = (items.get(t.id) as { name: string }[] | undefined)?.[0]?.name;
          const sub = scheduled
            ? `予定 · ${genre} · まだ使った額に入りません`
            : isFixed(t)
              ? `固定費 · ${Number(t.occurredOn.slice(5, 7))}月分`
              : `${shortDate(t.occurredOn)} · ${firstItem ?? genre}`;
          const income = t.amountYen > 0;
          return (
            <li key={t.id}>
              {i > 0 ? (
                <div className="ml-16 h-px" style={{ background: 'var(--hairline)' }} />
              ) : null}
              <div className="flex items-center gap-3 py-2 pr-4 pl-2">
                <CategoryMark genreId={t.genreId} name={t.genreName} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate text-[16px] font-medium"
                    style={{ color: 'var(--ink)' }}
                  >
                    {t.label}
                  </span>
                  <span className="truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {sub}
                  </span>
                </span>
                <span
                  className={`tabular shrink-0 text-[16px]${scheduled ? '' : ' font-semibold'}`}
                  style={{
                    color: scheduled ? 'var(--ink-muted)' : income ? 'var(--income)' : 'var(--ink)',
                  }}
                >
                  {income ? '+' : ''}
                  {Math.abs(t.amountYen).toLocaleString('ja-JP')}円
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
